import { createHmac, randomBytes } from "node:crypto";

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32Encode(buffer: Buffer) {
  let bits = 0;
  let value = 0;
  let output = "";

  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }

  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }
  return output;
}

function base32Decode(value: string) {
  const normalized = value.toUpperCase().replace(/=+$/g, "").replace(/\s+/g, "");
  let bits = 0;
  let current = 0;
  const bytes: number[] = [];

  for (const char of normalized) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) {
      continue;
    }
    current = (current << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((current >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }

  return Buffer.from(bytes);
}

function hotp(secretBase32: string, counter: number, digits = 6) {
  const secret = base32Decode(secretBase32);
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  counterBuffer.writeUInt32BE(counter >>> 0, 4);

  const hmac = createHmac("sha1", secret).update(counterBuffer).digest();
  const offset = (hmac[hmac.length - 1] ?? 0) & 0x0f;
  const b0 = hmac[offset] ?? 0;
  const b1 = hmac[offset + 1] ?? 0;
  const b2 = hmac[offset + 2] ?? 0;
  const b3 = hmac[offset + 3] ?? 0;
  const codeInt =
    ((b0 & 0x7f) << 24) |
    ((b1 & 0xff) << 16) |
    ((b2 & 0xff) << 8) |
    (b3 & 0xff);
  const mod = 10 ** digits;
  return String(codeInt % mod).padStart(digits, "0");
}

export function generateTotpSecret() {
  return base32Encode(randomBytes(20));
}

export function verifyTotpCode(params: {
  secretBase32: string;
  code: string;
  periodSeconds?: number;
  digits?: number;
  allowedWindowSteps?: number;
  nowMs?: number;
}) {
  const periodSeconds = params.periodSeconds ?? 30;
  const digits = params.digits ?? 6;
  const allowedWindowSteps = params.allowedWindowSteps ?? 1;
  const nowMs = params.nowMs ?? Date.now();

  const normalizedCode = params.code.trim().replace(/\s+/g, "");
  if (!/^\d{6,8}$/.test(normalizedCode)) {
    return false;
  }

  const counter = Math.floor(nowMs / 1000 / periodSeconds);
  for (let i = -allowedWindowSteps; i <= allowedWindowSteps; i += 1) {
    const expected = hotp(params.secretBase32, counter + i, digits);
    if (expected === normalizedCode) {
      return true;
    }
  }
  return false;
}

export function buildTotpOtpauthUrl(params: {
  secretBase32: string;
  accountName: string;
  issuer: string;
  digits?: number;
  periodSeconds?: number;
}) {
  const digits = params.digits ?? 6;
  const periodSeconds = params.periodSeconds ?? 30;
  const issuer = encodeURIComponent(params.issuer);
  const accountName = encodeURIComponent(params.accountName);
  const secret = encodeURIComponent(params.secretBase32);
  return `otpauth://totp/${issuer}:${accountName}?secret=${secret}&issuer=${issuer}&digits=${digits}&period=${periodSeconds}`;
}
