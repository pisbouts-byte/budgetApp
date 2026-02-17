export type BudgetPeriod = "WEEKLY" | "MONTHLY";

export interface Money {
  amount: string;
  currencyCode: string;
}

export interface BudgetProgress {
  period: BudgetPeriod;
  spent: Money;
  remaining: Money;
  progressRatio: number;
}

