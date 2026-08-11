import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import notificationsRoutes from "./routes/notifications.js";
import { startEventConsumers } from "./eventConsumers.js";
import { installProcessSafetyNets, errorHandler } from "./lib/errorHandling.js";

installProcessSafetyNets("notification-service");

const app = express();
app.set("trust proxy", false); // no reverse proxy in front locally; a production deployment behind one should set the hop count instead
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: "256kb" }));

app.use("/notifications", notificationsRoutes);

app.get("/health", (_req, res) => res.json({ status: "ok", service: "notification-service" }));

startEventConsumers();

app.use(errorHandler);

const port = Number(process.env.PORT ?? 4006);
app.listen(port, () => console.log(`notification-service listening on :${port}`));
