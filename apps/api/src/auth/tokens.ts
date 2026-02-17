import jwt from "jsonwebtoken";
import { env } from "../config/env.js";

export interface AuthClaims {
  sub: string;
  email: string;
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
