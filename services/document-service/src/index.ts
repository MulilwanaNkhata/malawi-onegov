import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import filesRoutes from "./routes/files.js";
import { installProcessSafetyNets, errorHandler } from "./lib/errorHandling.js";

installProcessSafetyNets("document-service");

const app = express();
app.set("trust proxy", false); // no reverse proxy in front locally; a production deployment behind one should set the hop count instead
app.use(helmet());
app.use(cors());
// express.json() only parses application/json bodies, so it's a no-op for
// the multipart upload route below (multer handles that one instead).
app.use(express.json({ limit: "1mb" }));

app.use("/files", filesRoutes);

app.get("/health", (_req, res) => res.json({ status: "ok", service: "document-service" }));

app.use(errorHandler);

const port = Number(process.env.PORT ?? 4004);
app.listen(port, () => console.log(`document-service listening on :${port}`));
