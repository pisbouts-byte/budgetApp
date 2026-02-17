export type BudgetPeriod = "WEEKLY" | "MONTHLY";

function toDateOnly(date: Date) {
  return date.toISOString().slice(0, 10);
}

function fromDateOnly(value: string) {
  return new Date(`${value}T00:00:00.000Z`);
}

function addDays(base: Date, days: number) {
  const next = new Date(base);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

export function getBudgetPeriodWindow(params: {
  period: BudgetPeriod;
  referenceDate: string;
  weekStartDay: number;
}) {
  const { period, referenceDate, weekStartDay } = params;
  const ref = fromDateOnly(referenceDate);

  if (period === "MONTHLY") {
    const start = new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth(), 1));
    const end = new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth() + 1, 0));
    return {
      startDate: toDateOnly(start),
      endDate: toDateOnly(end)
    };
  }

  const day = ref.getUTCDay(); // 0=Sun ... 6=Sat
  const distance = (day - weekStartDay + 7) % 7;
  const start = addDays(ref, -distance);
  const end = addDays(start, 6);

  return {
    startDate: toDateOnly(start),
    endDate: toDateOnly(end)
  };
}

export function paceRatio(params: {
  budgetAmount: number;
  spent: number;
  periodStartDate: string;
  periodEndDate: string;
  referenceDate: string;
}) {
  const { budgetAmount, spent, periodStartDate, periodEndDate, referenceDate } = params;

  const start = fromDateOnly(periodStartDate);
  const end = fromDateOnly(periodEndDate);
  const ref = fromDateOnly(referenceDate);

  const boundedRef = ref < start ? start : ref > end ? end : ref;
  const totalDays = Math.max(
    1,
    Math.floor((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1
  );
  const elapsedDays = Math.max(
    1,
    Math.floor((boundedRef.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1
  );

  const expectedSpent = budgetAmount * (elapsedDays / totalDays);
  if (expectedSpent <= 0) {
    return spent > 0 ? 1 : 0;
  }

  return Number((spent / expectedSpent).toFixed(6));
}

