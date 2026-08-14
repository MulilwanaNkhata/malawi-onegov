import type { NextFunction, Request, Response } from "express";

/**
 * See identity-service/src/lib/errorHandling.ts for the full rationale: this
 * is a safety net against unhandled promise rejections (which otherwise
 * crash the whole container) and a consistent JSON 500 for anything that
 * does flow through Express's next(err) pipeline.
 */
export function installProcessSafetyNets(serviceName: string): void {
  process.on("unhandledRejection", (reason) => {
    console.error(`[${serviceName}] unhandled promise rejection:`, reason);
  });
  process.on("uncaughtException", (err) => {
    console.error(`[${serviceName}] uncaught exception:`, err);
  });
}

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  console.error("[error]", err);
  if (res.headersSent) return;
  res.status(500).json({ error: "internal_server_error" });
}
