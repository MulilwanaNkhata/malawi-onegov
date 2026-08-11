import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET ?? "dev-insecure-jwt-secret-change-me";

interface AccessTokenClaims {
  sub: string;
  role: string;
  fullName: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AccessTokenClaims;
    }
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return res.status(401).json({ error: "missing_bearer_token" });
  try {
    req.user = jwt.verify(header.slice(7), JWT_SECRET) as AccessTokenClaims;
    next();
  } catch {
    return res.status(401).json({ error: "invalid_or_expired_token" });
  }
}
