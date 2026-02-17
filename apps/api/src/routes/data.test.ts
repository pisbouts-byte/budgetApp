import assert from "node:assert/strict";
import test from "node:test";
import { db } from "../db/pool.js";
import { DEFAULT_RETENTION_DAYS } from "../data-retention/policy.js";
import { dataRouter } from "./data.js";

interface RequestMock {
  auth?: {
    userId: string;
    email: string;
  };
  body?: unknown;
}

interface ResponseMock {
  statusCode: number;
  payload: unknown;
  status: (code: number) => ResponseMock;
  json: (payload: unknown) => ResponseMock;
}

function makeResponse(): ResponseMock {
  return {
    statusCode: 200,
    payload: null,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.payload = payload;
      return this;
    }
  };
}

function findRouteHandler(method: "get" | "post" | "delete", path: string) {
  const layer = (dataRouter.stack as any[]).find(
    (candidate) =>
      candidate.route?.path === path &&
      candidate.route?.methods?.[method] === true
  ) as any;
  if (!layer) {
    throw new Error(`Expected ${method.toUpperCase()} route for path ${path}`);
  }
  return layer.route.stack[layer.route.stack.length - 1]?.handle as (
    req: RequestMock,
    res: ResponseMock,
    next: () => void
  ) => Promise<void>;
}

const originalQuery = (db as any).query;
const originalConnect = (db as any).connect;

function restoreDbFns() {
  (db as any).query = originalQuery;
  (db as any).connect = originalConnect;
}

test("DELETE /data/me validates confirm payload", async () => {
  const handler = findRouteHandler("delete", "/me");
  const res = makeResponse();

  await handler(
    {
      auth: { userId: "user-1", email: "user@example.com" },
      body: { confirm: "NOPE" }
    },
    res,
    () => undefined
  );

  assert.equal(res.statusCode, 400);
  const payload = res.payload as { error: string };
  assert.equal(payload.error, "Invalid request");
});

test("GET /data/deletion-preview returns mapped numeric counts", async () => {
  const handler = findRouteHandler("get", "/deletion-preview");
  const res = makeResponse();

  (db as any).query = async () => ({
    rows: [
      {
        app_user_count: "1",
        plaid_item_count: "2",
        account_count: "3",
        transaction_count: "4",
        category_count: "5",
        category_rule_count: "6",
        category_change_event_count: "7",
        budget_count: "8",
        budget_snapshot_count: "9",
        report_preset_count: "10",
        sync_job_count: "11"
      }
    ]
  });

  try {
    await handler(
      {
        auth: { userId: "user-1", email: "user@example.com" }
      },
      res,
      () => undefined
    );
  } finally {
    restoreDbFns();
  }

  assert.equal(res.statusCode, 200);
  const payload = res.payload as {
    userId: string;
    counts: { syncJobs: number; appUser: number };
  };
  assert.equal(payload.userId, "user-1");
  assert.equal(payload.counts.appUser, 1);
  assert.equal(payload.counts.syncJobs, 11);
});

test("DELETE /data/me deletes user when found", async () => {
  const handler = findRouteHandler("delete", "/me");
  const res = makeResponse();

  (db as any).query = async () => ({
    rowCount: 1,
    rows: [{ id: "user-1" }]
  });

  try {
    await handler(
      {
        auth: { userId: "user-1", email: "user@example.com" },
        body: { confirm: "DELETE" }
      },
      res,
      () => undefined
    );
  } finally {
    restoreDbFns();
  }

  assert.equal(res.statusCode, 200);
  const payload = res.payload as { deleted: boolean; userId: string };
  assert.equal(payload.deleted, true);
  assert.equal(payload.userId, "user-1");
});

test("POST /data/retention/purge validates input", async () => {
  const handler = findRouteHandler("post", "/retention/purge");
  const res = makeResponse();

  await handler(
    {
      auth: { userId: "user-1", email: "user@example.com" },
      body: { syncJobDays: 0 }
    },
    res,
    () => undefined
  );

  assert.equal(res.statusCode, 400);
  const payload = res.payload as { error: string };
  assert.equal(payload.error, "Invalid retention request");
});

test("POST /data/retention/purge runs transactional purge and returns counts", async () => {
  const handler = findRouteHandler("post", "/retention/purge");
  const res = makeResponse();
  const statements: string[] = [];
  let released = false;

  (db as any).connect = async () => ({
    query: async (sql: string) => {
      const normalized = sql.trim().replace(/\s+/g, " ");
      statements.push(normalized);

      if (normalized === "BEGIN" || normalized === "COMMIT") {
        return { rowCount: null, rows: [] };
      }
      if (normalized.startsWith("DELETE FROM category_change_event")) {
        return { rowCount: 2, rows: [] };
      }
      if (normalized.startsWith("DELETE FROM budget_snapshot bs")) {
        return { rowCount: 3, rows: [] };
      }
      if (normalized.startsWith("DELETE FROM sync_job")) {
        return { rowCount: 4, rows: [] };
      }
      return { rowCount: 0, rows: [] };
    },
    release: () => {
      released = true;
    }
  });

  try {
    await handler(
      {
        auth: { userId: "user-1", email: "user@example.com" },
        body: {}
      },
      res,
      () => undefined
    );
  } finally {
    restoreDbFns();
  }

  assert.equal(res.statusCode, 200);
  assert.equal(statements[0], "BEGIN");
  assert.equal(statements[statements.length - 1], "COMMIT");
  assert.equal(released, true);

  const payload = res.payload as {
    purged: boolean;
    retentionDays: { syncJob: number };
    deletedCounts: { syncJob: number };
  };
  assert.equal(payload.purged, true);
  assert.equal(payload.retentionDays.syncJob, DEFAULT_RETENTION_DAYS.syncJob);
  assert.equal(payload.deletedCounts.syncJob, 4);
});
