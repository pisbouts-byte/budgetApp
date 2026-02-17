import assert from "node:assert/strict";
import test from "node:test";
import { decryptSecret, encryptSecret } from "./token-crypto.js";

test("encrypts and decrypts token payload", () => {
  const plaintext = "access-sandbox-123";
  const encrypted = encryptSecret(plaintext);

  assert.notEqual(encrypted, plaintext);
  assert.ok(encrypted.startsWith("enc:v1:"));
  assert.equal(decryptSecret(encrypted), plaintext);
});

test("decrypt returns plaintext for legacy unencrypted rows", () => {
  const legacy = "legacy-plaintext-token";
  assert.equal(decryptSecret(legacy), legacy);
});

test("decrypt throws for malformed encrypted payload", () => {
  assert.throws(
    () => decryptSecret("enc:v1:bad-payload"),
    /Invalid encrypted payload format/
  );
});
