import { Router } from "express";
import { z } from "zod";
import {
  clearAuthCookie,
  clearCsrfCookie,
  issueCsrfToken,
  readCookieValue,
  setAuthCookie
} from "../auth/cookies.js";
import { requireAuth, type AuthenticatedRequest } from "../auth/middleware.js";
import { hashPassword, verifyPassword } from "../auth/passwords.js";
import { buildTotpOtpauthUrl, generateTotpSecret, verifyTotpCode } from "../auth/totp.js";
import {
  signAccessToken,
  signMfaChallengeToken,
  verifyMfaChallengeToken
} from "../auth/tokens.js";
import { writeAuditEvent } from "../audit/events.js";
import { env } from "../config/env.js";
import { db } from "../db/pool.js";
import { decryptSecret, encryptSecret } from "../security/token-crypto.js";

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  displayName: z.string().min(1).max(120).optional()
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8)
});
const updatePreferencesSchema = z.object({
  weekStartDay: z.number().int().min(0).max(6),
  currencyCode: z
    .string()
    .regex(/^[A-Z]{3}$/)
    .optional()
});
const mfaSetupSchema = z.object({
  issuer: z.string().min(2).max(120).optional()
});
const mfaEnableSchema = z.object({
  code: z.string().min(6).max(8)
});
const mfaDisableSchema = z.object({
  code: z.string().min(6).max(8)
});
const mfaVerifyLoginSchema = z.object({
  challengeToken: z.string().min(20),
  code: z.string().min(6).max(8)
});

function requestContext(req: { ip?: string; socket?: { remoteAddress?: string | null }; headers: Record<string, unknown> }) {
  const userAgentRaw = req.headers["user-agent"];
  const requestIdRaw = req.headers["x-request-id"];
  return {
    ipAddress: req.ip || req.socket?.remoteAddress || null,
    userAgent: typeof userAgentRaw === "string" ? userAgentRaw : null,
    requestId: typeof requestIdRaw === "string" ? requestIdRaw : null
  };
}

function isMissingMfaSchema(error: unknown) {
  return (error as { code?: string })?.code === "42703";
}

export const authRouter = Router();

authRouter.post("/register", async (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: "Invalid request",
      details: parsed.error.flatten()
    });
  }

  const email = parsed.data.email.toLowerCase().trim();
  const passwordHash = await hashPassword(parsed.data.password);
  const displayName = parsed.data.displayName?.trim() || null;

  try {
    const result = await db.query<{
      id: string;
      email: string;
      display_name: string | null;
    }>(
      `INSERT INTO app_user (email, display_name, password_hash)
       VALUES ($1, $2, $3)
       RETURNING id, email, display_name`,
      [email, displayName, passwordHash]
    );

    const user = result.rows[0];
    if (!user) {
      return res.status(500).json({ error: "Failed to register user" });
    }
    const token = signAccessToken({ sub: user.id, email: user.email });
    setAuthCookie(res, token);
    const csrfToken = issueCsrfToken(res);
    const context = requestContext(req);
    void writeAuditEvent({
      userId: user.id,
      eventType: "auth.register.success",
      ...context,
      metadata: { email: user.email }
    });

    return res.status(201).json({
      user: {
        id: user.id,
        email: user.email,
        displayName: user.display_name
      },
      csrfToken
    });
  } catch (error) {
    const context = requestContext(req);
    void writeAuditEvent({
      eventType: "auth.register.failed",
      ...context,
      metadata: { email, errorCode: (error as { code?: string })?.code ?? null }
    });
    if ((error as { code?: string }).code === "23505") {
      return res.status(409).json({ error: "Email already registered" });
    }
    return res.status(500).json({ error: "Failed to register user" });
  }
});

authRouter.post("/login", async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: "Invalid request",
      details: parsed.error.flatten()
    });
  }

  const email = parsed.data.email.toLowerCase().trim();
  const result = await db.query<{
    id: string;
    email: string;
    display_name: string | null;
    password_hash: string;
    mfa_enabled: boolean;
    mfa_totp_secret_encrypted: string | null;
  }>(
    `SELECT id, email, display_name, password_hash, mfa_enabled, mfa_totp_secret_encrypted
     FROM app_user
     WHERE email = $1`,
    [email]
  );

  const user = result.rows[0];
  if (!user) {
    const context = requestContext(req);
    void writeAuditEvent({
      eventType: "auth.login.failed",
      ...context,
      metadata: { email, reason: "USER_NOT_FOUND" }
    });
    return res.status(401).json({ error: "Invalid credentials" });
  }

  const isValid = await verifyPassword(parsed.data.password, user.password_hash);
  if (!isValid) {
    const context = requestContext(req);
    void writeAuditEvent({
      userId: user.id,
      eventType: "auth.login.failed",
      ...context,
      metadata: { email, reason: "INVALID_PASSWORD" }
    });
    return res.status(401).json({ error: "Invalid credentials" });
  }

  if (user.mfa_enabled && user.mfa_totp_secret_encrypted) {
    const challengeToken = signMfaChallengeToken({
      sub: user.id,
      email: user.email,
      purpose: "mfa_login"
    });
    const context = requestContext(req);
    void writeAuditEvent({
      userId: user.id,
      eventType: "auth.mfa.login.challenge_issued",
      ...context,
      metadata: { email: user.email }
    });
    return res.status(200).json({
      mfaRequired: true,
      challengeToken
    });
  }

  const token = signAccessToken({ sub: user.id, email: user.email });
  setAuthCookie(res, token);
  const csrfToken = issueCsrfToken(res);
  const context = requestContext(req);
  void writeAuditEvent({
    userId: user.id,
    eventType: "auth.login.success",
    ...context,
    metadata: { email: user.email }
  });
  return res.json({
    user: {
      id: user.id,
      email: user.email,
      displayName: user.display_name
    },
    csrfToken
  });
});

authRouter.post("/mfa/verify-login", async (req, res) => {
  const parsed = mfaVerifyLoginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: "Invalid request",
      details: parsed.error.flatten()
    });
  }

  let claims;
  try {
    claims = verifyMfaChallengeToken(parsed.data.challengeToken);
  } catch {
    return res.status(401).json({ error: "Invalid or expired MFA challenge" });
  }

  if (claims.purpose !== "mfa_login") {
    return res.status(401).json({ error: "Invalid MFA challenge purpose" });
  }

  try {
    const result = await db.query<{
      id: string;
      email: string;
      display_name: string | null;
      mfa_enabled: boolean;
      mfa_totp_secret_encrypted: string | null;
    }>(
      `SELECT id, email, display_name, mfa_enabled, mfa_totp_secret_encrypted
       FROM app_user
       WHERE id = $1`,
      [claims.sub]
    );
    const user = result.rows[0];
    if (!user || !user.mfa_enabled || !user.mfa_totp_secret_encrypted) {
      return res.status(401).json({ error: "MFA is not enabled for this account" });
    }

    const secret = decryptSecret(user.mfa_totp_secret_encrypted);
    const isValid = verifyTotpCode({
      secretBase32: secret,
      code: parsed.data.code
    });
    if (!isValid) {
      const context = requestContext(req);
      void writeAuditEvent({
        userId: user.id,
        eventType: "auth.mfa.login.failed",
        ...context,
        metadata: { reason: "INVALID_CODE" }
      });
      return res.status(401).json({ error: "Invalid MFA code" });
    }

    await db.query(
      `UPDATE app_user
       SET mfa_last_verified_at = now()
       WHERE id = $1`,
      [user.id]
    );

    const token = signAccessToken({ sub: user.id, email: user.email });
    setAuthCookie(res, token);
    const csrfToken = issueCsrfToken(res);
    const context = requestContext(req);
    void writeAuditEvent({
      userId: user.id,
      eventType: "auth.mfa.login.success",
      ...context
    });

    return res.json({
      user: {
        id: user.id,
        email: user.email,
        displayName: user.display_name
      },
      csrfToken
    });
  } catch (error) {
    if (isMissingMfaSchema(error)) {
      return res.status(503).json({ error: "MFA schema not applied yet" });
    }
    return res.status(500).json({ error: "Failed to verify MFA login" });
  }
});

authRouter.post("/logout", (req: AuthenticatedRequest, res) => {
  clearAuthCookie(res);
  clearCsrfCookie(res);
  const context = requestContext(req);
  void writeAuditEvent({
    userId: req.auth?.userId ?? null,
    eventType: "auth.logout",
    ...context
  });
  return res.status(204).send();
});

authRouter.get("/me", requireAuth, async (req: AuthenticatedRequest, res) => {
  const userId = req.auth?.userId;
  if (!userId) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const result = await db.query<{
    id: string;
    email: string;
    display_name: string | null;
    week_start_day: number;
    currency_code: string;
  }>(
    `SELECT id, email, display_name, week_start_day, currency_code
     FROM app_user
     WHERE id = $1`,
    [userId]
  );

  const user = result.rows[0];
  if (!user) {
    return res.status(404).json({ error: "User not found" });
  }

  const existingCsrfToken = readCookieValue(
    req.headers.cookie,
    env.AUTH_CSRF_COOKIE_NAME
  );
  const csrfToken = existingCsrfToken ?? issueCsrfToken(res);

  return res.json({
    id: user.id,
    email: user.email,
    displayName: user.display_name,
    weekStartDay: user.week_start_day,
    currencyCode: user.currency_code,
    csrfToken
  });
});

authRouter.get("/mfa/status", requireAuth, async (req: AuthenticatedRequest, res) => {
  const userId = req.auth?.userId;
  if (!userId) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const result = await db.query<{
      mfa_enabled: boolean;
      mfa_enrolled_at: string | null;
      mfa_last_verified_at: string | null;
    }>(
      `SELECT mfa_enabled, mfa_enrolled_at::text, mfa_last_verified_at::text
       FROM app_user
       WHERE id = $1`,
      [userId]
    );
    const row = result.rows[0];
    if (!row) {
      return res.status(404).json({ error: "User not found" });
    }
    return res.json({
      enabled: row.mfa_enabled,
      enrolledAt: row.mfa_enrolled_at,
      lastVerifiedAt: row.mfa_last_verified_at
    });
  } catch (error) {
    if (isMissingMfaSchema(error)) {
      return res.status(503).json({ error: "MFA schema not applied yet" });
    }
    return res.status(500).json({ error: "Failed to read MFA status" });
  }
});

authRouter.post("/mfa/setup", requireAuth, async (req: AuthenticatedRequest, res) => {
  const userId = req.auth?.userId;
  if (!userId) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  const parsed = mfaSetupSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({
      error: "Invalid request",
      details: parsed.error.flatten()
    });
  }

  try {
    const userResult = await db.query<{ email: string; mfa_enabled: boolean }>(
      `SELECT email, mfa_enabled
       FROM app_user
       WHERE id = $1`,
      [userId]
    );
    const user = userResult.rows[0];
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }
    if (user.mfa_enabled) {
      return res.status(409).json({ error: "MFA is already enabled" });
    }

    const secret = generateTotpSecret();
    const issuer = parsed.data.issuer?.trim() || "Spending Tracker";
    const otpauthUrl = buildTotpOtpauthUrl({
      secretBase32: secret,
      accountName: user.email,
      issuer
    });

    await db.query(
      `UPDATE app_user
       SET mfa_totp_secret_encrypted = $2,
           mfa_enabled = FALSE,
           mfa_enrolled_at = NULL
       WHERE id = $1`,
      [userId, encryptSecret(secret)]
    );

    const context = requestContext(req);
    void writeAuditEvent({
      userId,
      eventType: "auth.mfa.setup.started",
      ...context,
      metadata: { issuer }
    });

    return res.json({
      issuer,
      accountName: user.email,
      secret,
      otpauthUrl,
      periodSeconds: 30,
      digits: 6
    });
  } catch (error) {
    if (isMissingMfaSchema(error)) {
      return res.status(503).json({ error: "MFA schema not applied yet" });
    }
    return res.status(500).json({ error: "Failed to initialize MFA setup" });
  }
});

authRouter.post("/mfa/enable", requireAuth, async (req: AuthenticatedRequest, res) => {
  const userId = req.auth?.userId;
  if (!userId) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  const parsed = mfaEnableSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: "Invalid request",
      details: parsed.error.flatten()
    });
  }

  try {
    const rowResult = await db.query<{
      mfa_totp_secret_encrypted: string | null;
    }>(
      `SELECT mfa_totp_secret_encrypted
       FROM app_user
       WHERE id = $1`,
      [userId]
    );
    const row = rowResult.rows[0];
    if (!row) {
      return res.status(404).json({ error: "User not found" });
    }
    if (!row.mfa_totp_secret_encrypted) {
      return res.status(409).json({ error: "MFA setup has not been started" });
    }

    const secret = decryptSecret(row.mfa_totp_secret_encrypted);
    const isValid = verifyTotpCode({
      secretBase32: secret,
      code: parsed.data.code
    });
    if (!isValid) {
      const context = requestContext(req);
      void writeAuditEvent({
        userId,
        eventType: "auth.mfa.enable.failed",
        ...context,
        metadata: { reason: "INVALID_CODE" }
      });
      return res.status(401).json({ error: "Invalid MFA code" });
    }

    await db.query(
      `UPDATE app_user
       SET mfa_enabled = TRUE,
           mfa_enrolled_at = now(),
           mfa_last_verified_at = now()
       WHERE id = $1`,
      [userId]
    );
    const context = requestContext(req);
    void writeAuditEvent({
      userId,
      eventType: "auth.mfa.enabled",
      ...context
    });

    return res.json({ enabled: true });
  } catch (error) {
    if (isMissingMfaSchema(error)) {
      return res.status(503).json({ error: "MFA schema not applied yet" });
    }
    return res.status(500).json({ error: "Failed to enable MFA" });
  }
});

authRouter.post("/mfa/disable", requireAuth, async (req: AuthenticatedRequest, res) => {
  const userId = req.auth?.userId;
  if (!userId) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  const parsed = mfaDisableSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: "Invalid request",
      details: parsed.error.flatten()
    });
  }

  try {
    const rowResult = await db.query<{
      mfa_enabled: boolean;
      mfa_totp_secret_encrypted: string | null;
    }>(
      `SELECT mfa_enabled, mfa_totp_secret_encrypted
       FROM app_user
       WHERE id = $1`,
      [userId]
    );
    const row = rowResult.rows[0];
    if (!row) {
      return res.status(404).json({ error: "User not found" });
    }
    if (!row.mfa_enabled || !row.mfa_totp_secret_encrypted) {
      return res.status(409).json({ error: "MFA is not enabled" });
    }

    const secret = decryptSecret(row.mfa_totp_secret_encrypted);
    const isValid = verifyTotpCode({
      secretBase32: secret,
      code: parsed.data.code
    });
    if (!isValid) {
      const context = requestContext(req);
      void writeAuditEvent({
        userId,
        eventType: "auth.mfa.disable.failed",
        ...context,
        metadata: { reason: "INVALID_CODE" }
      });
      return res.status(401).json({ error: "Invalid MFA code" });
    }

    await db.query(
      `UPDATE app_user
       SET mfa_enabled = FALSE,
           mfa_totp_secret_encrypted = NULL,
           mfa_enrolled_at = NULL
       WHERE id = $1`,
      [userId]
    );
    const context = requestContext(req);
    void writeAuditEvent({
      userId,
      eventType: "auth.mfa.disabled",
      ...context
    });

    return res.json({ enabled: false });
  } catch (error) {
    if (isMissingMfaSchema(error)) {
      return res.status(503).json({ error: "MFA schema not applied yet" });
    }
    return res.status(500).json({ error: "Failed to disable MFA" });
  }
});

authRouter.patch(
  "/preferences",
  requireAuth,
  async (req: AuthenticatedRequest, res) => {
    const userId = req.auth?.userId;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const parsed = updatePreferencesSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: "Invalid request",
        details: parsed.error.flatten()
      });
    }

    const payload = parsed.data;
    try {
      const updated = await db.query<{
        id: string;
        week_start_day: number;
        currency_code: string;
      }>(
        `UPDATE app_user
         SET week_start_day = $2,
             currency_code = COALESCE($3, currency_code)
         WHERE id = $1
         RETURNING id, week_start_day, currency_code`,
        [userId, payload.weekStartDay, payload.currencyCode ?? null]
      );

      const row = updated.rows[0];
      if (!row) {
        return res.status(404).json({ error: "User not found" });
      }
      const context = requestContext(req);
      void writeAuditEvent({
        userId,
        eventType: "auth.preferences.updated",
        ...context,
        metadata: {
          weekStartDay: row.week_start_day,
          currencyCode: row.currency_code
        }
      });

      return res.json({
        id: row.id,
        weekStartDay: row.week_start_day,
        currencyCode: row.currency_code
      });
    } catch {
      return res.status(500).json({ error: "Failed to update preferences" });
    }
  }
);
