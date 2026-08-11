import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import eventsRoutes from "./routes/events.js";
import { installProcessSafetyNets, errorHandler } from "./lib/errorHandling.js";

installProcessSafetyNets("audit-service");

const app = express();
app.set("trust proxy", false); // no reverse proxy in front locally; a production deployment behind one should set the hop count instead
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: "256kb" }));

app.use("/events", eventsRoutes);

app.get("/health", (_req, res) => res.json({ status: "ok", service: "audit-service" }));

app.use(errorHandler);

const port = Number(process.env.PORT ?? 4002);
app.listen(port, () => console.log(`audit-service listening on :${port}`));
