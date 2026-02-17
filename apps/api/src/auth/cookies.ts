import type { CookieOptions, Response } from "express";
import { env } from "../config/env.js";

function authCookieOptions(): CookieOptions {
  const isProduction = env.NODE_ENV === "production";
  return {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? "none" : "lax",
    path: "/",
    maxAge: 7 * 24 * 60 * 60 * 1000
  };
}

export function setAuthCookie(res: Response, token: string) {
  res.cookie(env.AUTH_COOKIE_NAME, token, authCookieOptions());
}

export function clearAuthCookie(res: Response) {
  res.clearCookie(env.AUTH_COOKIE_NAME, authCookieOptions());
}

export function readCookieToken(rawCookieHeader: string | undefined) {
  if (!rawCookieHeader) {
    return null;
  }

  const target = `${env.AUTH_COOKIE_NAME}=`;
  const parts = rawCookieHeader.split(";");
  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed.startsWith(target)) {
      continue;
    }
    const rawValue = trimmed.slice(target.length).trim();
    if (!rawValue) {
      return null;
    }
    try {
      return decodeURIComponent(rawValue);
    } catch {
      return rawValue;
    }
  }

  return null;
}
