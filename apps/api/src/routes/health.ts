import { Router } from "express";
import { metricsSnapshot } from "../observability/metrics.js";

export const healthRouter = Router();

healthRouter.get("/", (_req, res) => {
  res.json({
    ok: true,
    timestamp: new Date().toISOString()
  });
});

healthRouter.get("/metrics", (_req, res) => {
  res.json({
    ok: true,
    timestamp: new Date().toISOString(),
    metrics: metricsSnapshot()
  });
});
