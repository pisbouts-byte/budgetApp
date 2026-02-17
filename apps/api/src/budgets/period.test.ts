import assert from "node:assert/strict";
import test from "node:test";
import { getBudgetPeriodWindow, paceRatio } from "./period.js";

test("weekly window honors custom week start day", () => {
  const period = getBudgetPeriodWindow({
    period: "WEEKLY",
    referenceDate: "2026-02-12",
    weekStartDay: 1
  });

  assert.deepEqual(period, {
    startDate: "2026-02-09",
    endDate: "2026-02-15"
  });
});

test("monthly window spans entire calendar month", () => {
  const period = getBudgetPeriodWindow({
    period: "MONTHLY",
    referenceDate: "2026-02-12",
    weekStartDay: 0
  });

  assert.deepEqual(period, {
    startDate: "2026-02-01",
    endDate: "2026-02-28"
  });
});

test("pace ratio uses bounded reference date and elapsed period", () => {
  const ratio = paceRatio({
    budgetAmount: 300,
    spent: 180,
    periodStartDate: "2026-02-01",
    periodEndDate: "2026-02-10",
    referenceDate: "2026-02-05"
  });

  assert.equal(ratio, 1.2);
});
