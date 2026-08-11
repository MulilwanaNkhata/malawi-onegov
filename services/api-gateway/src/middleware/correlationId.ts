import type { NextFunction, Request, Response } from "express";
import { v4 as uuidv4 } from "uuid";

/**
 * Every request entering the platform through the gateway gets a
 * correlation id, forwarded to whichever downstream service handles it.
 * Combined with the audit-service's hash-chained log and each service's
 * request logging, this is what lets an incident responder trace one
 * citizen action across service boundaries.
 */
export function correlationId(req: Request, res: Response, next: NextFunction) {
  const id = (req.headers["x-correlation-id"] as string | undefined) ?? uuidv4();
  req.headers["x-correlation-id"] = id;
  res.setHeader("x-correlation-id", id);
  next();
}
