import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import axios from "axios";
import rateLimit from "express-rate-limit";
import path from "path";
import { fileURLToPath } from "url";
import { createProxyMiddleware } from "http-proxy-middleware";
import swaggerUiDist from "swagger-ui-dist";
import { correlationId } from "./middleware/correlationId.js";
import { installProcessSafetyNets, errorHandler } from "./lib/errorHandling.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

installProcessSafetyNets("api-gateway");

const app = express();
app.set("trust proxy", false); // no reverse proxy in front locally; a production deployment behind one should set the hop count instead
app.use(helmet());
app.use(cors());
app.use(morgan("combined"));
app.use(correlationId);

// Deliberately no express.json() here: bodies must reach downstream services
// as an untouched stream for http-proxy-middleware to forward them correctly
// (this matters most for the multipart file upload route).

const IDENTITY_SERVICE_URL = process.env.IDENTITY_SERVICE_URL ?? "http://identity-service:4001";
const AUDIT_SERVICE_URL = process.env.AUDIT_SERVICE_URL ?? "http://audit-service:4002";
const WORKFLOW_SERVICE_URL = process.env.WORKFLOW_SERVICE_URL ?? "http://workflow-service:4003";
const DOCUMENT_SERVICE_URL = process.env.DOCUMENT_SERVICE_URL ?? "http://document-service:4004";
const PAYMENT_SERVICE_URL = process.env.PAYMENT_SERVICE_URL ?? "http://payment-service:4005";
const NOTIFICATION_SERVICE_URL = process.env.NOTIFICATION_SERVICE_URL ?? "http://notification-service:4006";
const CIVIL_REGISTRATION_SERVICE_URL =
  process.env.CIVIL_REGISTRATION_SERVICE_URL ?? "http://civil-registration-service:4007";
const TRADING_LICENSE_SERVICE_URL =
  process.env.TRADING_LICENSE_SERVICE_URL ?? "http://trading-license-service:4008";
const USSD_GATEWAY_URL = process.env.USSD_GATEWAY_URL ?? "http://ussd-gateway:4009";

// General API traffic.
app.use(rateLimit({ windowMs: 60_000, max: 300, standardHeaders: true, legacyHeaders: false }));

// Auth endpoints are a brute-force target -- tighter limit, enforced again here
// in front of identity-service's own limiter (defense in depth). Applied by
// path check rather than `app.use("/api/auth", ...)` so it composes safely
// with the proxies below (see note there about mount-path stripping).
const authLimiter = rateLimit({ windowMs: 60_000, max: 20, standardHeaders: true, legacyHeaders: false });
app.use((req, res, next) => (req.path.startsWith("/api/auth") ? authLimiter(req, res, next) : next()));

// NOTE: these are intentionally mounted at the app root (no `app.use("/api/x", ...)`
// path argument) and instead pass the path as http-proxy-middleware's own
// "context" filter. `app.use(path, mw)` makes Express strip `path` off
// `req.url` before `mw` ever sees it, which would silently break the
// `pathRewrite` regexes below (they'd never match the already-stripped URL).
// Mounting at root keeps `req.url` intact so both the context filter and the
// pathRewrite operate on the real, original path.
app.use(
  createProxyMiddleware("/api/auth", {
    target: IDENTITY_SERVICE_URL,
    changeOrigin: true,
    pathRewrite: { "^/api/auth": "/auth" },
  })
);
app.use(
  createProxyMiddleware("/api/users", {
    target: IDENTITY_SERVICE_URL,
    changeOrigin: true,
    pathRewrite: { "^/api/users": "/users" },
  })
);
app.use(
  createProxyMiddleware("/api/applications", {
    target: CIVIL_REGISTRATION_SERVICE_URL,
    changeOrigin: true,
    pathRewrite: { "^/api/applications": "/applications" },
  })
);
app.use(
  createProxyMiddleware("/api/trading-licenses", {
    target: TRADING_LICENSE_SERVICE_URL,
    changeOrigin: true,
    pathRewrite: { "^/api/trading-licenses": "/licenses" },
  })
);
app.use(
  createProxyMiddleware("/api/payments", {
    target: PAYMENT_SERVICE_URL,
    changeOrigin: true,
    pathRewrite: { "^/api/payments": "/payments" },
  })
);
app.use(
  createProxyMiddleware("/api/documents", {
    target: DOCUMENT_SERVICE_URL,
    changeOrigin: true,
    pathRewrite: { "^/api/documents": "/files" },
  })
);
app.use(
  createProxyMiddleware("/api/notifications", {
    target: NOTIFICATION_SERVICE_URL,
    changeOrigin: true,
    pathRewrite: { "^/api/notifications": "/notifications" },
  })
);
app.use(
  createProxyMiddleware("/api/audit", {
    target: AUDIT_SERVICE_URL,
    changeOrigin: true,
    pathRewrite: { "^/api/audit": "/events" },
  })
);
app.use(
  createProxyMiddleware("/api/workflow", {
    target: WORKFLOW_SERVICE_URL,
    changeOrigin: true,
    pathRewrite: { "^/api/workflow": "/instances" },
  })
);
// Not under /api/ deliberately: this is the webhook a USSD aggregator (e.g.
// Africa's Talking) calls directly, a different contract (plain text
// CON/END responses, not JSON) from the rest of the citizen-facing API.
app.use(
  createProxyMiddleware("/ussd", {
    target: USSD_GATEWAY_URL,
    changeOrigin: true,
  })
);

app.get("/health", (_req, res) => res.json({ status: "ok", service: "api-gateway" }));

/** Aggregate liveness view across the whole platform -- useful for a status page or synthetic monitor. */
app.get("/health/deep", async (_req, res) => {
  const targets: Record<string, string> = {
    identity: IDENTITY_SERVICE_URL,
    audit: AUDIT_SERVICE_URL,
    workflow: WORKFLOW_SERVICE_URL,
    document: DOCUMENT_SERVICE_URL,
    payment: PAYMENT_SERVICE_URL,
    notification: NOTIFICATION_SERVICE_URL,
    civilRegistration: CIVIL_REGISTRATION_SERVICE_URL,
    tradingLicense: TRADING_LICENSE_SERVICE_URL,
    ussdGateway: USSD_GATEWAY_URL,
  };
  const results = await Promise.all(
    Object.entries(targets).map(async ([name, url]) => {
      try {
        await axios.get(`${url}/health`, { timeout: 2000 });
        return [name, "up"] as const;
      } catch {
        return [name, "down"] as const;
      }
    })
  );
  const services = Object.fromEntries(results);
  const allUp = results.every(([, status]) => status === "up");
  res.status(allUp ? 200 : 503).json({ status: allUp ? "ok" : "degraded", services });
});

// Developer portal: interactive API docs for the public contract, served
// straight off the gateway rather than a separate site, since the gateway
// *is* the public entry point. docs/openapi.yaml at the repo root is the
// single source of truth (bind-mounted into this container -- see
// docker-compose.yml); swagger-ui-dist ships Swagger UI's static assets
// fully self-contained, no CDN or internet access needed at runtime.
const OPENAPI_SPEC_PATH = process.env.OPENAPI_SPEC_PATH ?? path.join(__dirname, "../openapi.yaml");

app.get("/docs/openapi.yaml", (_req, res) => res.sendFile(OPENAPI_SPEC_PATH));
app.get("/docs", (_req, res) => {
  res.type("html").send(`<!doctype html>
<html>
<head>
  <title>Malawi OneGov API</title>
  <link rel="stylesheet" href="/docs/swagger-ui.css" />
  <style>body { margin: 0; }</style>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="/docs/swagger-ui-bundle.js"></script>
  <script src="/docs/swagger-ui-standalone-preset.js"></script>
  <script>
    window.onload = () => {
      window.ui = SwaggerUIBundle({
        url: "/docs/openapi.yaml",
        dom_id: "#swagger-ui",
        presets: [SwaggerUIBundle.presets.apis, SwaggerUIStandalonePreset],
      });
    };
  </script>
</body>
</html>`);
});
app.use("/docs", express.static(swaggerUiDist.getAbsoluteFSPath()));

app.use(errorHandler);

const port = Number(process.env.PORT ?? 4000);
app.listen(port, () => console.log(`api-gateway listening on :${port}`));
