import jwt from "jsonwebtoken";
import { env } from "../config/env.js";

export interface AuthClaims {
  sub: string;
  email: string;
}

export interface MfaChallengeClaims {
  sub: string;
  email: string;
  purpose: "mfa_login";
}

export function signAccessToken(claims: AuthClaims) {
  const expiresIn = env.JWT_EXPIRES_IN as jwt.SignOptions["expiresIn"];
  return jwt.sign(claims, env.JWT_SECRET, {
    expiresIn
  });
}

export function verifyAccessToken(token: string) {
  return jwt.verify(token, env.JWT_SECRET) as AuthClaims;
}

export function signMfaChallengeToken(claims: MfaChallengeClaims) {
  return jwt.sign(claims, env.JWT_SECRET, {
    expiresIn: "5m"
  });
}

export function verifyMfaChallengeToken(token: string) {
  return jwt.verify(token, env.JWT_SECRET) as MfaChallengeClaims;
}
