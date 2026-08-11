import type { NextFunction, Request, Response } from "express";

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
  // USSD aggregators expect a plain-text response even on error, not JSON.
  res.status(200).type("text/plain").send("END A system error occurred. Please try again shortly.");
}
