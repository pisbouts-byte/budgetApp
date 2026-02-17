import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_RETENTION_DAYS,
  retentionCutoffDate
} from "./policy.js";

test("default retention day config is non-zero", () => {
  assert.ok(DEFAULT_RETENTION_DAYS.categoryChangeEvent > 0);
  assert.ok(DEFAULT_RETENTION_DAYS.budgetSnapshot > 0);
  assert.ok(DEFAULT_RETENTION_DAYS.syncJob > 0);
});

test("retention cutoff date subtracts full-day duration", () => {
  const now = new Date("2026-02-12T12:00:00.000Z");
  const cutoff = retentionCutoffDate(30, now);
  assert.equal(cutoff, "2026-01-13T12:00:00.000Z");
});
