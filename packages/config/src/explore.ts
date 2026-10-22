export const exploreConfig = {
  POLICY_VERSION: 'explore-greedy-v1',
  FEATURE_VERSION: 'stated-logistics-v1',
  WEEKLY_CRON: '0 14 * * 1',
  DELIVERY_CRON: '* * * * *',
  MAINTENANCE_CRON: '* * * * *',
  NEXT_BATCH_LABEL: 'Monday, after operator review',
} as const;
