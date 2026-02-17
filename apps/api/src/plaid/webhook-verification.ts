import { createHash, createPublicKey, timingSafeEqual, type KeyObject } from "node:crypto";
import jwt from "jsonwebtoken";
import { env } from "../config/env.js";
import { plaidClient } from "./client.js";

interface VerificationPayload extends jwt.JwtPayload {
  request_body_sha256?: string;
}

interface CachedKey {
  publicKey: KeyObject;
  expiresAtUnix: number | null;
}

const keyCache = new Map<string, CachedKey>();
const MAX_IAT_SKEW_SECONDS = 5 * 60;

function sha256Hex(input: string) {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

function secureEqualHex(a: string, b: string) {
  const left = Buffer.from(a.toLowerCase(), "utf8");
  const right = Buffer.from(b.toLowerCase(), "utf8");
  if (left.length !== right.length) {
    return false;
  }
  return timingSafeEqual(left, right);
}

async function getPlaidWebhookKey(kid: string) {
  const nowUnix = Math.floor(Date.now() / 1000);
  const cached = keyCache.get(kid);
  if (cached && (!cached.expiresAtUnix || cached.expiresAtUnix > nowUnix)) {
    return cached.publicKey;
  }

  const response = await plaidClient.webhookVerificationKeyGet({
    key_id: kid
  });
  const key = response.data.key;
  const publicKey = createPublicKey({
    key: {
      kty: key.kty,
      crv: key.crv,
      x: key.x,
      y: key.y,
      use: key.use,
      alg: key.alg,
      kid: key.kid
    },
    format: "jwk"
  });

  const expiresAtUnix = key.expired_at
    ? Math.floor(new Date(key.expired_at).getTime() / 1000)
    : null;
  keyCache.set(kid, { publicKey, expiresAtUnix });
  return publicKey;
}

export async function verifyPlaidWebhookSignature(params: {
  plaidVerificationHeader: string | undefined;
  rawBody: string;
}) {
  if (!env.PLAID_WEBHOOK_VERIFICATION_ENABLED) {
    return { ok: true as const };
  }

  const token = params.plaidVerificationHeader?.trim();
  if (!token) {
    return { ok: false as const, reason: "Missing Plaid-Verification header" };
  }

  const decoded = jwt.decode(token, { complete: true });
  if (!decoded || typeof decoded === "string") {
    return { ok: false as const, reason: "Invalid Plaid verification token format" };
  }

  const kid = typeof decoded.header.kid === "string" ? decoded.header.kid : null;
  const alg = typeof decoded.header.alg === "string" ? decoded.header.alg : null;
  if (!kid || alg !== "ES256") {
    return { ok: false as const, reason: "Invalid Plaid verification token header" };
  }

  try {
    const publicKey = await getPlaidWebhookKey(kid);
    const verified = jwt.verify(token, publicKey, {
      algorithms: ["ES256"]
    }) as VerificationPayload;

    if (!verified.iat || typeof verified.iat !== "number") {
      return { ok: false as const, reason: "Missing iat claim in Plaid verification token" };
    }

    const nowUnix = Math.floor(Date.now() / 1000);
    if (Math.abs(nowUnix - verified.iat) > MAX_IAT_SKEW_SECONDS) {
      return { ok: false as const, reason: "Stale Plaid verification token" };
    }

    if (
      !verified.request_body_sha256 ||
      typeof verified.request_body_sha256 !== "string"
    ) {
      return {
        ok: false as const,
        reason: "Missing request_body_sha256 claim in Plaid verification token"
      };
    }

    const expectedHash = sha256Hex(params.rawBody);
    if (!secureEqualHex(expectedHash, verified.request_body_sha256)) {
      return { ok: false as const, reason: "Plaid webhook body hash mismatch" };
    }

    return { ok: true as const };
  } catch {
    return { ok: false as const, reason: "Plaid webhook signature verification failed" };
  }
}
