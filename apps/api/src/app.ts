import cors from "cors";
import express from "express";
import { randomUUID } from "crypto";
import type { NextFunction, Request, Response } from "express";
import { requireCsrfForCookieAuth } from "./auth/csrf.js";
import { env } from "./config/env.js";
import { logError, logInfo } from "./observability/logger.js";
import { recordRequest } from "./observability/metrics.js";
import { authRouter } from "./routes/auth.js";
import { budgetsRouter } from "./routes/budgets.js";
import { categoriesRouter } from "./routes/categories.js";
import { dataRouter } from "./routes/data.js";
import { healthRouter } from "./routes/health.js";
import { plaidRouter } from "./routes/plaid.js";
import { reportsRouter } from "./routes/reports.js";
import { rulesRouter } from "./routes/rules.js";
import { transactionsRouter } from "./routes/transactions.js";
import { webhooksRouter } from "./routes/webhooks.js";

function getRequestPath(req: Request) {
  return req.originalUrl || req.url;
}

function allowedCorsOrigins() {
  if (!env.CORS_ORIGINS?.trim()) {
    return [];
  }

  return env.CORS_ORIGINS.split(",")
    .map((origin) => origin.trim())
    .map((origin) => {
      if (
        (origin.startsWith("\"") && origin.endsWith("\"")) ||
        (origin.startsWith("'") && origin.endsWith("'"))
      ) {
        return origin.slice(1, -1).trim();
      }
      return origin;
    })
    .map((origin) => {
      try {
        return new URL(origin).origin;
      } catch {
        return origin.replace(/\/+$/, "");
      }
    })
    .filter(Boolean);
}

export function createApp() {
  const app = express();
  const corsOrigins = allowedCorsOrigins();
  if (env.NODE_ENV === "production" && corsOrigins.length > 0) {
    app.use(
      cors({
        credentials: true,
        origin: (origin, callback) => {
          if (!origin) {
            callback(null, true);
            return;
          }
          let normalizedOrigin = origin;
          try {
            normalizedOrigin = new URL(origin).origin;
          } catch {
            normalizedOrigin = origin.replace(/\/+$/, "");
          }
          if (corsOrigins.includes(normalizedOrigin)) {
            callback(null, true);
            return;
          }
          callback(new Error("Blocked by CORS policy"));
        }
      })
    );
  } else {
    app.use(
      cors({
        credentials: true,
        origin: true
      })
    );
  }

  const buckets = new Map<string, { count: number; resetAt: number }>();
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.path.startsWith("/health")) {
      return next();
    }

    const key = req.ip || req.socket.remoteAddress || "unknown";
    const now = Date.now();
    const current = buckets.get(key);
    const resetAt = current && current.resetAt > now ? current.resetAt : now + env.RATE_LIMIT_WINDOW_MS;
    const count = current && current.resetAt > now ? current.count + 1 : 1;
    buckets.set(key, { count, resetAt });

    const remaining = Math.max(0, env.RATE_LIMIT_MAX_REQUESTS - count);
    res.setHeader("x-ratelimit-limit", String(env.RATE_LIMIT_MAX_REQUESTS));
    res.setHeader("x-ratelimit-remaining", String(remaining));
    res.setHeader("x-ratelimit-reset", String(Math.ceil(resetAt / 1000)));

    if (count > env.RATE_LIMIT_MAX_REQUESTS) {
      return res.status(429).json({ error: "Too many requests. Please retry later." });
    }
    return next();
  });

  app.use(
    express.json({
      verify: (req, _res, buf) => {
        (req as Request & { rawBody?: string }).rawBody = buf.toString("utf8");
      }
    })
  );
  app.use(requireCsrfForCookieAuth);
  app.use((req: Request, res: Response, next: NextFunction) => {
    const requestId = randomUUID();
    const start = process.hrtime.bigint();
    res.setHeader("x-request-id", requestId);

    logInfo("request.start", {
      requestId,
      method: req.method,
      path: getRequestPath(req)
    });

    res.on("finish", () => {
      const durationMs = Number(process.hrtime.bigint() - start) / 1_000_000;
      const roundedDurationMs = Number(durationMs.toFixed(3));
      recordRequest(res.statusCode, roundedDurationMs);
      logInfo("request.finish", {
        requestId,
        method: req.method,
        path: getRequestPath(req),
        statusCode: res.statusCode,
        durationMs: roundedDurationMs
      });
    });

    next();
  });

  app.get("/", (_req, res) => {
    res.json({
      service: "spending-tracker-api",
      status: "ok"
    });
  });

  app.use("/health", healthRouter);
  app.use("/auth", authRouter);
  app.use("/budgets", budgetsRouter);
  app.use("/categories", categoriesRouter);
  app.use("/data", dataRouter);
  app.use("/plaid", plaidRouter);
  app.use("/reports", reportsRouter);
  app.use("/rules", rulesRouter);
  app.use("/transactions", transactionsRouter);
  app.use("/webhooks", webhooksRouter);
  app.use((error: unknown, req: Request, res: Response, _next: NextFunction) => {
    const statusCode =
      typeof (error as { status?: unknown })?.status === "number"
        ? Number((error as { status: number }).status)
        : 500;
    const message =
      error instanceof Error ? error.message : "Unhandled non-error exception";
    logError("request.error", {
      method: req.method,
      path: getRequestPath(req),
      statusCode,
      message
    });

    if (res.headersSent) {
      return;
    }
    res.status(statusCode).json({ error: "Internal server error" });
  });
  return app;
}
