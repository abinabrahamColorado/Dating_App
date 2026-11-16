/** M5 operational cadence; numeric product hypotheses remain in pilot.ts. */
export const lifecycleConfig = {
  ORPHAN_GRACE_HOURS: 24,
  FEEDBACK_CRON: '*/5 * * * *',
  RETENTION_CRON: '17 * * * *',
  REQUESTS_PER_MINUTE: 30,
  PAGE_SIZE: 25,
  WORK_BATCH_SIZE: 20,
  ATTENTION_MAX_SECONDS: 60,
  ATTENTION_IDLE_SECONDS: 300,
  ARTIFACT_MAX_BYTES: 256 * 1024 * 1024,
} as const;
