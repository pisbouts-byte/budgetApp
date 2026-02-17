import { randomBytes, timingSafeEqual } from "node:crypto";
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

function baseCookieOptions(): CookieOptions {
  const isProduction = env.NODE_ENV === "production";
  return {
    secure: isProduction,
    sameSite: isProduction ? "none" : "lax",
    path: "/"
  };
}

function csrfCookieOptions(): CookieOptions {
  return {
    ...baseCookieOptions(),
    httpOnly: false,
    maxAge: 7 * 24 * 60 * 60 * 1000
  };
}

export function issueCsrfToken(res: Response) {
  const token = randomBytes(32).toString("hex");
  res.cookie(env.AUTH_CSRF_COOKIE_NAME, token, csrfCookieOptions());
  return token;
}

export function clearCsrfCookie(res: Response) {
  res.clearCookie(env.AUTH_CSRF_COOKIE_NAME, csrfCookieOptions());
}

export function readCookieValue(
  rawCookieHeader: string | undefined,
  cookieName: string
) {
  if (!rawCookieHeader) {
    return null;
  }

  const target = `${cookieName}=`;
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

export function readCookieToken(rawCookieHeader: string | undefined) {
  return readCookieValue(rawCookieHeader, env.AUTH_COOKIE_NAME);
}

export function tokensEqual(left: string, right: string) {
  const a = Buffer.from(left, "utf8");
  const b = Buffer.from(right, "utf8");
  if (a.length !== b.length) {
    return false;
  }
  return timingSafeEqual(a, b);
}
