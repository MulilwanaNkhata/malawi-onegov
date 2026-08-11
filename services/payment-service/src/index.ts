import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import paymentsRoutes from "./routes/payments.js";
import { installProcessSafetyNets, errorHandler } from "./lib/errorHandling.js";

installProcessSafetyNets("payment-service");

const app = express();
app.set("trust proxy", false); // no reverse proxy in front locally; a production deployment behind one should set the hop count instead
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: "256kb" }));

app.use("/payments", paymentsRoutes);

app.get("/health", (_req, res) => res.json({ status: "ok", service: "payment-service" }));

app.use(errorHandler);

const port = Number(process.env.PORT ?? 4005);
app.listen(port, () => console.log(`payment-service listening on :${port}`));
