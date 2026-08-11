import { Router } from "express";
import { z } from "zod";
import { db } from "../lib/db.js";
import { requireService } from "../middleware/requireService.js";
import { getTemplate, findTransition } from "../templates.js";
import { publishEvent } from "../lib/eventBus.js";
import { recordAuditEvent } from "../lib/audit.js";

const router = Router();

const createSchema = z.object({
  templateCode: z.string(),
  entityType: z.string(),
  entityId: z.string(),
});

router.post("/", requireService, async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "validation_error" });
  const { templateCode, entityType, entityId } = parsed.data;

  const template = getTemplate(templateCode);
  if (!template) return res.status(400).json({ error: "unknown_template", templateCode });

  const instance = await db.workflowInstance.create({
    data: { templateCode, entityType, entityId, currentState: template.initialState },
  });

  await recordAuditEvent({
    actorUserId: null,
    actorRole: "SYSTEM",
    action: "WORKFLOW_INSTANCE_CREATED",
    resourceType: entityType,
    resourceId: entityId,
    metadata: { instanceId: instance.id, state: instance.currentState },
  });

  return res.status(201).json(instance);
});

router.get("/:id", requireService, async (req, res) => {
  const instance = await db.workflowInstance.findUnique({
    where: { id: req.params.id },
    include: { transitions: { orderBy: { createdAt: "asc" } } },
  });
  if (!instance) return res.status(404).json({ error: "not_found" });
  return res.json(instance);
});

router.get("/", requireService, async (req, res) => {
  const { entityType, entityId } = req.query;
  const instance = await db.workflowInstance.findFirst({
    where: {
      entityType: typeof entityType === "string" ? entityType : undefined,
      entityId: typeof entityId === "string" ? entityId : undefined,
    },
    include: { transitions: { orderBy: { createdAt: "asc" } } },
  });
  if (!instance) return res.status(404).json({ error: "not_found" });
  return res.json(instance);
});

const transitionSchema = z.object({
  action: z.string(),
  actorUserId: z.string().nullable().optional(),
  actorRole: z.string(),
  comment: z.string().optional(),
});

export async function applyTransition(
  instanceId: string,
  input: z.infer<typeof transitionSchema>
): Promise<{ ok: true; instance: Awaited<ReturnType<typeof db.workflowInstance.update>> } | { ok: false; status: number; error: string }> {
  const instance = await db.workflowInstance.findUnique({ where: { id: instanceId } });
  if (!instance) return { ok: false, status: 404, error: "not_found" };

  const template = getTemplate(instance.templateCode);
  if (!template) return { ok: false, status: 500, error: "unknown_template" };

  const rule = findTransition(template, instance.currentState, input.action);
  if (!rule) {
    return { ok: false, status: 409, error: `no_transition_${input.action}_from_${instance.currentState}` };
  }
  if (!rule.allowedRoles.includes(input.actorRole)) {
    return { ok: false, status: 403, error: "role_not_allowed_for_transition" };
  }

  const updated = await db.workflowInstance.update({
    where: { id: instanceId },
    data: {
      currentState: rule.to,
      transitions: {
        create: {
          fromState: rule.from,
          toState: rule.to,
          action: input.action,
          actorUserId: input.actorUserId ?? null,
          actorRole: input.actorRole,
          comment: input.comment,
        },
      },
    },
  });

  await recordAuditEvent({
    actorUserId: input.actorUserId ?? null,
    actorRole: input.actorRole,
    action: `WORKFLOW_TRANSITION_${input.action}`,
    resourceType: instance.entityType,
    resourceId: instance.entityId,
    metadata: { from: rule.from, to: rule.to, comment: input.comment },
  });

  await publishEvent("application.status_changed", {
    entityType: instance.entityType,
    entityId: instance.entityId,
    fromState: rule.from,
    toState: rule.to,
    action: input.action,
  });

  return { ok: true, instance: updated };
}

router.post("/:id/transitions", requireService, async (req, res) => {
  const parsed = transitionSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "validation_error", details: parsed.error.flatten() });

  const result = await applyTransition(req.params.id, parsed.data);
  if (!result.ok) return res.status(result.status).json({ error: result.error });
  return res.json(result.instance);
});

export default router;
