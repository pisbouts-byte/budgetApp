export type RuleField =
  | "MERCHANT_NAME"
  | "ORIGINAL_DESCRIPTION"
  | "MCC"
  | "PLAID_DETAILED_CATEGORY"
  | "PLAID_PRIMARY_CATEGORY";

export type RuleOperator = "EQUALS";

export interface LearnedRuleCandidate {
  field: RuleField;
  operator: RuleOperator;
  pattern: string;
  priority: number;
}

interface RuleSourceTransaction {
  merchantName: string | null;
  originalDescription: string;
  mcc: string | null;
  plaidDetailedCategory: string | null;
  plaidPrimaryCategory: string | null;
}

function normalized(value: string | null | undefined) {
  return value?.trim().toLowerCase() || null;
}

// Deterministic priority order for learned rules:
// merchant -> description -> mcc -> plaid detailed -> plaid primary.
export function buildLearnedRuleCandidate(
  tx: RuleSourceTransaction
): LearnedRuleCandidate | null {
  const merchant = normalized(tx.merchantName);
  if (merchant) {
    return {
      field: "MERCHANT_NAME",
      operator: "EQUALS",
      pattern: merchant,
      priority: 10
    };
  }

  const description = normalized(tx.originalDescription);
  if (description) {
    return {
      field: "ORIGINAL_DESCRIPTION",
      operator: "EQUALS",
      pattern: description,
      priority: 20
    };
  }

  const mcc = normalized(tx.mcc);
  if (mcc) {
    return {
      field: "MCC",
      operator: "EQUALS",
      pattern: mcc,
      priority: 30
    };
  }

  const plaidDetailed = normalized(tx.plaidDetailedCategory);
  if (plaidDetailed) {
    return {
      field: "PLAID_DETAILED_CATEGORY",
      operator: "EQUALS",
      pattern: plaidDetailed,
      priority: 40
    };
  }

  const plaidPrimary = normalized(tx.plaidPrimaryCategory);
  if (plaidPrimary) {
    return {
      field: "PLAID_PRIMARY_CATEGORY",
      operator: "EQUALS",
      pattern: plaidPrimary,
      priority: 50
    };
  }

  return null;
}

