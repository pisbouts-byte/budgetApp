import type { NextFunction, Request, Response } from "express";
import { readCookieToken } from "./cookies.js";
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
  const bearerToken = header?.startsWith("Bearer ")
    ? header.replace("Bearer ", "").trim()
    : null;
  const cookieToken = readCookieToken(req.headers.cookie);
  const token = bearerToken || cookieToken;

  if (!token) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  try {
    const claims = verifyAccessToken(token);
    req.auth = {
      userId: claims.sub,
      email: claims.email
    };
    return next();
  } catch {
    if (bearerToken && cookieToken) {
      try {
        const claims = verifyAccessToken(cookieToken);
        req.auth = {
          userId: claims.sub,
          email: claims.email
        };
        return next();
      } catch {
        return res.status(401).json({ error: "Invalid or expired token" });
      }
    }
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}
