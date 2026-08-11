import type { NextFunction, Request, Response } from "express";
import { timingSafeEqual } from "crypto";

const SERVICE_SHARED_SECRET = process.env.SERVICE_SHARED_SECRET ?? "";

/**
 * Plain `===` leaks timing information proportional to how many leading
 * bytes match, which matters more than usual here: this secret is the only
 * thing standing between an external caller and forging a workflow
 * transition with any actorRole it likes (see applyTransition in
 * routes/instances.ts, which trusts the caller's claimed role outright).
 */
function safeEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}

/**
 * workflow-service has no citizen-facing routes -- it is only ever called
 * by other domain services (e.g. civil-registration-service) on behalf of
 * a citizen or staff action they have already authorized. So it trusts a
 * shared service secret rather than re-verifying citizen JWTs.
 */
export function requireService(req: Request, res: Response, next: NextFunction) {
  const provided = req.headers["x-service-secret"];
  if (typeof provided !== "string" || !safeEquals(provided, SERVICE_SHARED_SECRET)) {
    return res.status(401).json({ error: "unauthorized_service_call" });
  }
  next();
}
