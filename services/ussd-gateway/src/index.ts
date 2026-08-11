import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import ussdRoutes from "./routes/ussd.js";
import { installProcessSafetyNets, errorHandler } from "./lib/errorHandling.js";

installProcessSafetyNets("ussd-gateway");

const app = express();
app.set("trust proxy", false); // no reverse proxy in front locally; a production deployment behind one should set the hop count instead
app.use(helmet());
app.use(cors());
// USSD aggregators POST application/x-www-form-urlencoded; accept JSON too so the local simulator can use either.
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// One PIN check per request and a small keyspace (4-6 digits) makes this
// endpoint a brute-force target even though it's behind the aggregator, not
// the open internet -- cap it the same way identity-service caps /auth.
const ussdLimiter = rateLimit({ windowMs: 60_000, max: 30, standardHeaders: true, legacyHeaders: false });
app.use("/ussd", ussdLimiter, ussdRoutes);

app.get("/health", (_req, res) => res.json({ status: "ok", service: "ussd-gateway" }));

app.use(errorHandler);

const port = Number(process.env.PORT ?? 4009);
app.listen(port, () => console.log(`ussd-gateway listening on :${port}`));
