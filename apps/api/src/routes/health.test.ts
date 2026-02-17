import assert from "node:assert/strict";
import test from "node:test";
import { recordRequest } from "../observability/metrics.js";
import { healthRouter } from "./health.js";

interface JsonResponseMock {
  payload: unknown;
  json: (payload: unknown) => JsonResponseMock;
}

function findGetHandler(path: string) {
  const layer = (healthRouter.stack as any[]).find(
    (candidate) =>
      candidate.route?.path === path &&
      candidate.route?.methods?.get === true
  ) as any;
  if (!layer) {
    throw new Error(`Expected GET route for path ${path}`);
  }
  return layer.route.stack[0]?.handle as (
    req: unknown,
    res: JsonResponseMock,
    next: () => void
  ) => void;
}

function makeResponse(): JsonResponseMock {
  return {
    payload: null,
    json(payload: unknown) {
      this.payload = payload;
      return this;
    }
  };
}

test("GET /health returns ok payload", () => {
  const handler = findGetHandler("/");
  const res = makeResponse();
  handler({}, res, () => undefined);

  const payload = res.payload as { ok: boolean; timestamp: string };
  assert.equal(payload.ok, true);
  assert.ok(typeof payload.timestamp === "string");
});

test("GET /health/metrics returns metrics snapshot", () => {
  recordRequest(200, 5.5);
  const handler = findGetHandler("/metrics");
  const res = makeResponse();
  handler({}, res, () => undefined);

  const payload = res.payload as {
    ok: boolean;
    metrics: { requestsTotal: number };
  };
  assert.equal(payload.ok, true);
  assert.ok(payload.metrics.requestsTotal >= 1);
});
