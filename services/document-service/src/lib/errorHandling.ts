import type { NextFunction, Request, Response } from "express";

/**
 * Express 4 does not forward a rejected promise from an async route handler
 * into the error-handling pipeline -- if a handler awaits something that
 * throws without its own try/catch, Node treats it as an unhandled promise
 * rejection and (since Node 15) terminates the process by default. In
 * practice that meant a single bad request could take the entire service
 * down until someone noticed and restarted the container (this is exactly
 * what happened here once already, from a MinIO client misconfiguration).
 *
 * These two listeners are a safety net for exactly that case: log and keep
 * running, rather than crash. They are a backstop, not a substitute for
 * handling errors close to where they happen -- most routes in this service
 * already do that with their own try/catch.
 */
export function installProcessSafetyNets(serviceName: string): void {
  process.on("unhandledRejection", (reason) => {
    console.error(`[${serviceName}] unhandled promise rejection:`, reason);
  });
  process.on("uncaughtException", (err) => {
    console.error(`[${serviceName}] uncaught exception:`, err);
  });
}

/** Catches errors passed via next(err) (or thrown synchronously) and returns a clean JSON 500 instead of Express's default HTML error page. */
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  console.error("[error]", err);
  if (res.headersSent) return;
  res.status(500).json({ error: "internal_server_error" });
}
