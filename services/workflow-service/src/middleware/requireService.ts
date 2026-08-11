import type { NextFunction, Request, Response } from "express";

const SERVICE_SHARED_SECRET = process.env.SERVICE_SHARED_SECRET ?? "";

/**
 * workflow-service has no citizen-facing routes -- it is only ever called
 * by other domain services (e.g. civil-registration-service) on behalf of
 * a citizen or staff action they have already authorized. So it trusts a
 * shared service secret rather than re-verifying citizen JWTs.
 */
export function requireService(req: Request, res: Response, next: NextFunction) {
  if (req.headers["x-service-secret"] !== SERVICE_SHARED_SECRET) {
    return res.status(401).json({ error: "unauthorized_service_call" });
  }
  next();
}
