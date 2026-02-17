import { db } from "../db/pool.js";

type RuleField =
  | "MERCHANT_NAME"
  | "ORIGINAL_DESCRIPTION"
  | "ACCOUNT_NAME"
  | "MCC"
  | "PLAID_PRIMARY_CATEGORY"
  | "PLAID_DETAILED_CATEGORY";
type RuleOperator = "EQUALS" | "CONTAINS" | "STARTS_WITH" | "ENDS_WITH" | "REGEX";

interface CategoryRule {
  id: string;
  category_id: string;
  field: RuleField;
  operator: RuleOperator;
  pattern: string;
  priority: number;
  created_at: string;
}
export type MatchedCategoryRule = CategoryRule;

export interface TransactionMatchInput {
  userId: string;
  merchantName: string | null;
  originalDescription: string;
  accountName: string;
  mcc: string | null;
  plaidPrimaryCategory: string | null;
  plaidDetailedCategory: string | null;
}

function normalized(value: string | null | undefined) {
  return value?.trim().toLowerCase() || "";
}

function readFieldValue(rule: CategoryRule, tx: TransactionMatchInput) {
  switch (rule.field) {
    case "MERCHANT_NAME":
      return normalized(tx.merchantName);
    case "ORIGINAL_DESCRIPTION":
      return normalized(tx.originalDescription);
    case "ACCOUNT_NAME":
      return normalized(tx.accountName);
    case "MCC":
      return normalized(tx.mcc);
    case "PLAID_PRIMARY_CATEGORY":
      return normalized(tx.plaidPrimaryCategory);
    case "PLAID_DETAILED_CATEGORY":
      return normalized(tx.plaidDetailedCategory);
    default:
      return "";
  }
}

function matchesRule(rule: CategoryRule, tx: TransactionMatchInput) {
  const value = readFieldValue(rule, tx);
  const pattern = normalized(rule.pattern);

  if (!value || !pattern) {
    return false;
  }

  switch (rule.operator) {
    case "EQUALS":
      return value === pattern;
    case "CONTAINS":
      return value.includes(pattern);
    case "STARTS_WITH":
      return value.startsWith(pattern);
    case "ENDS_WITH":
      return value.endsWith(pattern);
    case "REGEX":
      try {
        return new RegExp(rule.pattern, "i").test(value);
      } catch {
        return false;
      }
    default:
      return false;
  }
}

function specificityScore(rule: CategoryRule) {
  const patternLen = rule.pattern.length;
  switch (rule.operator) {
    case "EQUALS":
      return 400 + patternLen;
    case "STARTS_WITH":
    case "ENDS_WITH":
      return 300 + patternLen;
    case "CONTAINS":
      return 200 + patternLen;
    case "REGEX":
      return 100 + patternLen;
    default:
      return patternLen;
  }
}

function compareRules(a: CategoryRule, b: CategoryRule) {
  if (a.priority !== b.priority) {
    return a.priority - b.priority;
  }

  const specificityDelta = specificityScore(b) - specificityScore(a);
  if (specificityDelta !== 0) {
    return specificityDelta;
  }

  if (a.created_at !== b.created_at) {
    return a.created_at.localeCompare(b.created_at);
  }
  return a.id.localeCompare(b.id);
}

export function confidenceForRule(rule: MatchedCategoryRule) {
  const operatorBase: Record<RuleOperator, number> = {
    EQUALS: 0.94,
    STARTS_WITH: 0.88,
    ENDS_WITH: 0.86,
    CONTAINS: 0.8,
    REGEX: 0.76
  };

  const priorityPenalty = Math.min(0.2, Math.max(0, (rule.priority - 10) * 0.002));
  const confidence = operatorBase[rule.operator] - priorityPenalty;
  return Math.max(0.55, Math.min(0.99, Number(confidence.toFixed(4))));
}

export async function listActiveCategoryRules(userId: string) {
  const rulesResult = await db.query<CategoryRule>(
    `SELECT id, category_id, field, operator, pattern, priority, created_at::text
     FROM category_rule
     WHERE user_id = $1
       AND is_active = TRUE`,
    [userId]
  );
  return rulesResult.rows;
}

export function findBestCategoryRuleFromList(
  rules: MatchedCategoryRule[],
  tx: TransactionMatchInput
) {
  const matches = rules.filter((rule) => matchesRule(rule, tx));
  if (matches.length === 0) {
    return null;
  }

  matches.sort(compareRules);
  return matches[0] ?? null;
}

export async function findBestCategoryRuleForTransaction(tx: TransactionMatchInput) {
  const rules = await listActiveCategoryRules(tx.userId);
  return findBestCategoryRuleFromList(rules, tx);
}
