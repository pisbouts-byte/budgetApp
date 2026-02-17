import type { NextFunction, Request, Response } from "express";
import { env } from "../config/env.js";
import { readCookieToken, readCookieValue, tokensEqual } from "./cookies.js";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const CSRF_EXEMPT_PATHS = new Set([
  "/auth/login",
  "/auth/register",
  "/login",
  "/register"
]);

function firstHeaderValue(value: string | string[] | undefined) {
  if (!value) {
    return null;
  }
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }
  return value;
}

export function requireCsrfForCookieAuth(
  req: Request,
  res: Response,
  next: NextFunction
) {
  if (SAFE_METHODS.has(req.method.toUpperCase())) {
    return next();
  }
  if (CSRF_EXEMPT_PATHS.has(req.path)) {
    return next();
  }

  const header = firstHeaderValue(req.headers.authorization);
  if (header?.startsWith("Bearer ")) {
    return next();
  }

  const rawCookie = req.headers.cookie;
  const authCookieToken = readCookieToken(rawCookie);
  if (!authCookieToken) {
    return next();
  }

  const csrfCookie = readCookieValue(rawCookie, env.AUTH_CSRF_COOKIE_NAME);
  const csrfHeader = firstHeaderValue(req.headers["x-csrf-token"]);

  if (!csrfCookie || !csrfHeader || !tokensEqual(csrfCookie, csrfHeader)) {
    return res.status(403).json({ error: "CSRF validation failed" });
  }

  return next();
}
