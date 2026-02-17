import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { createApp } from "./app.js";
import { metricsSnapshot } from "./observability/metrics.js";

class LifecycleResponseMock extends EventEmitter {
  statusCode = 204;
  headers = new Map<string, string>();

  setHeader(key: string, value: string) {
    this.headers.set(key.toLowerCase(), value);
  }
}

class ErrorResponseMock {
  headersSent = false;
  statusCode = 200;
  payload: unknown = null;

  status(code: number) {
    this.statusCode = code;
    return this;
  }

  json(payload: unknown) {
    this.payload = payload;
    return this;
  }
}

test("request lifecycle middleware sets request id, logs, and records metrics", () => {
  const app = createApp();
  const lifecycleLayer = (app as any)._router.stack.find((layer: { handle?: unknown }) => {
    if (typeof layer.handle !== "function") {
      return false;
    }
    const source = String(layer.handle);
    return source.includes("x-request-id") && source.includes("request.start");
  });
  assert.ok(lifecycleLayer, "request lifecycle middleware not found");
  const lifecycle = lifecycleLayer.handle as (
    req: { method: string; originalUrl: string; url: string },
    res: LifecycleResponseMock,
    next: () => void
  ) => void;

  const req = { method: "GET", originalUrl: "/test/path", url: "/test/path" };
  const res = new LifecycleResponseMock();
  const baseline = metricsSnapshot().requestsTotal;
  let nextCalled = false;
  const logs: string[] = [];

  const originalLog = console.log;
  console.log = (line: string) => {
    logs.push(line);
  };

  try {
    lifecycle(req, res, () => {
      nextCalled = true;
    });
    res.emit("finish");
  } finally {
    console.log = originalLog;
  }

  assert.equal(nextCalled, true);
  const requestId = res.headers.get("x-request-id");
  assert.ok(requestId);

  const parsed = logs.map((line) => JSON.parse(line) as Record<string, unknown>);
  assert.equal(parsed[0]?.event, "request.start");
  assert.equal(parsed[1]?.event, "request.finish");
  assert.equal(parsed[0]?.requestId, requestId);
  assert.equal(parsed[1]?.requestId, requestId);
  assert.equal(metricsSnapshot().requestsTotal, baseline + 1);
});

test("error middleware logs and returns safe 500 response", () => {
  const app = createApp();
  const errorMiddleware = (app as any)._router.stack[
    (app as any)._router.stack.length - 1
  ].handle as (
    error: unknown,
    req: { method: string; originalUrl: string; url: string },
    res: ErrorResponseMock,
    next: () => void
  ) => void;

  const req = { method: "POST", originalUrl: "/explode", url: "/explode" };
  const res = new ErrorResponseMock();
  const errors: string[] = [];
  const originalError = console.error;
  console.error = (line: string) => {
    errors.push(line);
  };

  try {
    errorMiddleware(new Error("boom"), req, res, () => undefined);
  } finally {
    console.error = originalError;
  }

  assert.equal(res.statusCode, 500);
  assert.deepEqual(res.payload, { error: "Internal server error" });
  const parsed = JSON.parse(errors[0] ?? "{}") as Record<string, unknown>;
  assert.equal(parsed.event, "request.error");
  assert.equal(parsed.path, "/explode");
});
