import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import instancesRoutes, { applyTransition } from "./routes/instances.js";
import { subscribeToEvents } from "./lib/eventBus.js";
import { db } from "./lib/db.js";
import { installProcessSafetyNets, errorHandler } from "./lib/errorHandling.js";

installProcessSafetyNets("workflow-service");

const app = express();
app.set("trust proxy", false); // no reverse proxy in front locally; a production deployment behind one should set the hop count instead
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: "256kb" }));

app.use("/instances", instancesRoutes);

app.get("/health", (_req, res) => res.json({ status: "ok", service: "workflow-service" }));

// Event-driven choreography: when payment-service confirms a fee payment,
// automatically move the matching workflow instance out of SUBMITTED into
// UNDER_REVIEW, without civil-registration-service having to poll for it.
subscribeToEvents(async (event) => {
  if (event.name !== "payment.completed") return;
  const { entityType, entityId } = event.data as { entityType: string; entityId: string };

  const instance = await db.workflowInstance.findUnique({ where: { entityType_entityId: { entityType, entityId } } });
  if (!instance) {
    console.warn("[workflow-service] payment.completed for unknown instance", entityType, entityId);
    return;
  }

  const result = await applyTransition(instance.id, {
    action: "PAYMENT_CONFIRMED",
    actorUserId: null,
    actorRole: "SYSTEM",
  });
  if (!result.ok) {
    console.warn("[workflow-service] auto payment transition rejected:", result.error);
  }
});

app.use(errorHandler);

const port = Number(process.env.PORT ?? 4003);
app.listen(port, () => console.log(`workflow-service listening on :${port}`));
