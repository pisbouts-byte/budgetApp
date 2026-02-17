# Rule Priority Strategy

Deterministic learned-rule priority order (lower number means higher precedence):

1. `MERCHANT_NAME` + `EQUALS` (priority `10`)
2. `ORIGINAL_DESCRIPTION` + `EQUALS` (priority `20`)
3. `MCC` + `EQUALS` (priority `30`)
4. `PLAID_DETAILED_CATEGORY` + `EQUALS` (priority `40`)
5. `PLAID_PRIMARY_CATEGORY` + `EQUALS` (priority `50`)

## Learning Flow
- On `PATCH /transactions/:transactionId/category` with `createRule=true` and non-null `categoryId`:
  - Update transaction category to `USER` source.
  - Write a `category_change_event` audit row.
  - Derive one learned rule candidate from the transaction using the priority order above.
  - Insert rule only if an active identical rule for user/category/field/operator/pattern does not already exist.

## Rule Application
- Single transaction rule apply:
  - `POST /transactions/:transactionId/apply-category-rules`
- Backfill apply for uncategorized transactions:
  - `POST /transactions/backfill-category-rules`
  - Supports `dryRun`, `limit`, and `includeExcluded`.

## Confidence
- Rule-based category assignments write `category_confidence` derived from:
  - operator type (stronger for `EQUALS`, weaker for `REGEX`)
  - rule priority (slight penalty for lower-priority rules)

## Normalization
- Text rule patterns are normalized to lowercase and trimmed before persistence.
- This keeps deterministic matching behavior predictable across duplicate merchant-name variants.
