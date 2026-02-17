export const DEFAULT_RETENTION_DAYS = {
  categoryChangeEvent: 730,
  budgetSnapshot: 365,
  syncJob: 90
} as const;

export function retentionCutoffDate(days: number, now = new Date()) {
  const cutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  return cutoff.toISOString();
}
