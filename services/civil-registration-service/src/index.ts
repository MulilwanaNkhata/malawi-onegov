import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import applicationsRoutes from "./routes/applications.js";
import { startEventConsumers } from "./eventConsumers.js";
import { installProcessSafetyNets, errorHandler } from "./lib/errorHandling.js";

installProcessSafetyNets("civil-registration-service");

const app = express();
app.set("trust proxy", false); // no reverse proxy in front locally; a production deployment behind one should set the hop count instead
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: "512kb" }));

app.use("/applications", applicationsRoutes);

app.get("/health", (_req, res) => res.json({ status: "ok", service: "civil-registration-service" }));

startEventConsumers();

app.use(errorHandler);

const port = Number(process.env.PORT ?? 4007);
app.listen(port, () => console.log(`civil-registration-service listening on :${port}`));
