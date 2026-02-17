import assert from "node:assert/strict";
import test from "node:test";
import { plaidCategoryLabel } from "./incremental-sync.js";

test("uses detailed plaid category and normalizes to title case", () => {
  const label = plaidCategoryLabel({
    transaction_id: "tx-1",
    amount: 10,
    iso_currency_code: "USD",
    date: "2026-02-12",
    name: "Coffee",
    pending: false,
    personal_finance_category: {
      primary: "FOOD_AND_DRINK",
      detailed: "FOOD_AND_DRINK_COFFEE"
    }
  });

  assert.equal(label, "Food And Drink Coffee");
});

test("falls back to primary category when detailed is missing", () => {
  const label = plaidCategoryLabel({
    transaction_id: "tx-2",
    amount: 10,
    iso_currency_code: "USD",
    date: "2026-02-12",
    name: "Snacks",
    pending: false,
    personal_finance_category: {
      primary: "GENERAL_MERCHANDISE"
    }
  });

  assert.equal(label, "General Merchandise");
});

test("returns null when plaid category fields are missing", () => {
  const label = plaidCategoryLabel({
    transaction_id: "tx-3",
    amount: 10,
    iso_currency_code: "USD",
    date: "2026-02-12",
    name: "Unknown",
    pending: false
  });

  assert.equal(label, null);
});
