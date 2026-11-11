/** Spec P6/P18. Infrastructure schedules, not member response deadlines. */
export const connectionConfig = {
  DELIVERY_CRON: '* * * * *',
  MAINTENANCE_CRON: '* * * * *',
  WORK_BATCH_SIZE: 20,
} as const;
