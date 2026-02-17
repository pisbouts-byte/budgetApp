import type { NextFunction, Request, Response } from "express";
import { verifyAccessToken } from "./tokens.js";

export interface AuthenticatedRequest extends Request {
  auth?: {
    userId: string;
    email: string;
  };
}

export function requireAuth(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Missing bearer token" });
  }

  const token = header.replace("Bearer ", "").trim();
  try {
    const claims = verifyAccessToken(token);
    req.auth = {
      userId: claims.sub,
      email: claims.email
    };
    return next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

