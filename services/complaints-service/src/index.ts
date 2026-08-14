import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import complaintsRoutes from "./routes/complaints.js";
import { startEventConsumers } from "./eventConsumers.js";
import { installProcessSafetyNets, errorHandler } from "./lib/errorHandling.js";

installProcessSafetyNets("complaints-service");

const app = express();
app.set("trust proxy", false); // no reverse proxy in front locally; a production deployment behind one should set the hop count instead
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: "512kb" }));

app.use("/complaints", complaintsRoutes);

app.get("/health", (_req, res) => res.json({ status: "ok", service: "complaints-service" }));

startEventConsumers();

app.use(errorHandler);

const port = Number(process.env.PORT ?? 4010);
app.listen(port, () => console.log(`complaints-service listening on :${port}`));
