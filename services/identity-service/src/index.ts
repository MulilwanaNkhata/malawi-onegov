import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import authRoutes from "./routes/auth.js";
import userRoutes from "./routes/users.js";
import { installProcessSafetyNets, errorHandler } from "./lib/errorHandling.js";

installProcessSafetyNets("identity-service");

const app = express();
app.set("trust proxy", false); // no reverse proxy in front locally; a production deployment behind one should set the hop count instead
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: "1mb" }));

// Auth endpoints are brute-force targets: tighter limit than general API traffic.
const authLimiter = rateLimit({ windowMs: 60_000, max: 20, standardHeaders: true, legacyHeaders: false });
app.use("/auth", authLimiter, authRoutes);
app.use("/users", userRoutes);

app.get("/health", (_req, res) => res.json({ status: "ok", service: "identity-service" }));

app.use(errorHandler);

const port = Number(process.env.PORT ?? 4001);
app.listen(port, () => console.log(`identity-service listening on :${port}`));
