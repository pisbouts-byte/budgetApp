import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { env } from "../config/env.js";

const ENCRYPTION_PREFIX = "enc:v1";
const ALGORITHM = "aes-256-gcm";

function keyBuffer() {
  return Buffer.from(env.ENCRYPTION_KEY, "hex");
}

export function encryptSecret(plaintext: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, keyBuffer(), iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final()
  ]);
  const tag = cipher.getAuthTag();

  return [
    ENCRYPTION_PREFIX,
    iv.toString("hex"),
    tag.toString("hex"),
    encrypted.toString("hex")
  ].join(":");
}

export function decryptSecret(payload: string) {
  if (!payload.startsWith(`${ENCRYPTION_PREFIX}:`)) {
    // Backward-compatibility fallback for legacy plaintext rows.
    return payload;
  }

  const remainder = payload.slice(`${ENCRYPTION_PREFIX}:`.length);
  const parts = remainder.split(":");
  if (parts.length !== 3) {
    throw new Error("Invalid encrypted payload format");
  }

  const iv = Buffer.from(parts[0] ?? "", "hex");
  const tag = Buffer.from(parts[1] ?? "", "hex");
  const encrypted = Buffer.from(parts[2] ?? "", "hex");

  const decipher = createDecipheriv(ALGORITHM, keyBuffer(), iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return decrypted.toString("utf8");
}
