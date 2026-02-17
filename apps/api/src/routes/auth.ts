import { Router } from "express";
import { z } from "zod";
import { requireAuth, type AuthenticatedRequest } from "../auth/middleware.js";
import { hashPassword, verifyPassword } from "../auth/passwords.js";
import { signAccessToken } from "../auth/tokens.js";
import { db } from "../db/pool.js";

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

    return res.status(201).json({
      user: {
        id: user.id,
        email: user.email,
        displayName: user.display_name
      },
      token
    });
  } catch (error) {
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
  }>(
    `SELECT id, email, display_name, password_hash
     FROM app_user
     WHERE email = $1`,
    [email]
  );

  const user = result.rows[0];
  if (!user) {
    return res.status(401).json({ error: "Invalid credentials" });
  }

  const isValid = await verifyPassword(parsed.data.password, user.password_hash);
  if (!isValid) {
    return res.status(401).json({ error: "Invalid credentials" });
  }

  const token = signAccessToken({ sub: user.id, email: user.email });
  return res.json({
    user: {
      id: user.id,
      email: user.email,
      displayName: user.display_name
    },
    token
  });
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

  return res.json({
    id: user.id,
    email: user.email,
    displayName: user.display_name,
    weekStartDay: user.week_start_day,
    currencyCode: user.currency_code
  });
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
