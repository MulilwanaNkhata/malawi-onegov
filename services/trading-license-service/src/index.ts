import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import licensesRoutes from "./routes/licenses.js";
import { startEventConsumers } from "./eventConsumers.js";
import { installProcessSafetyNets, errorHandler } from "./lib/errorHandling.js";

installProcessSafetyNets("trading-license-service");

const app = express();
app.set("trust proxy", false); // no reverse proxy in front locally; a production deployment behind one should set the hop count instead
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: "512kb" }));

app.use("/licenses", licensesRoutes);

app.get("/health", (_req, res) => res.json({ status: "ok", service: "trading-license-service" }));

startEventConsumers();

app.use(errorHandler);

const port = Number(process.env.PORT ?? 4008);
app.listen(port, () => console.log(`trading-license-service listening on :${port}`));
