import { pilot, retention } from '@meetwell/config/pilot';
import { addCalendarMonths } from './feedback';

/** P22: only collected categories have jobs; absent GPS, embeddings, research
 * demographics, vendors and model artifacts are never manufactured for retention. */
export function retentionCutoffs(now: Date) {
  const days = (n: number) => new Date(now.getTime() - n * 86400000);
  return {
    learning: days(retention.D5_TRAINING_ROWS_DAYS),
    feedback: days(retention.D8_IDENTIFIABLE_FEEDBACK_DAYS),
    chat: days(retention.D11_CHAT_AFTER_CLOSURE_DAYS),
    plans: days(retention.D12_PLAN_AFTER_CLOSURE_DAYS),
    counters: days(retention.D13_MINIMIZED_COUNTER_DAYS),
    logs: days(retention.D13_RAW_SECURITY_LOG_DAYS),
    inactiveReview: days(retention.D5_INACTIVE_REVIEW_DAYS),
    auditReview: days(retention.AUDIT_REVIEW_DAYS),
    safety: addCalendarMonths(now, -retention.D9_SAFETY_AFTER_CLOSURE_MONTHS),
    safetyReview: addCalendarMonths(now, -retention.D9_REVIEW_MONTHS),
    backups: days(pilot.BACKUP_EXPIRY_DAYS),
  };
}
export function deletionDeadline(requested: Date) {
  return new Date(requested.getTime() + pilot.DELETION_ACTIVE_STORES_DAYS * 86400000);
}
export const lifecycleInventory = {
  primary: 'identity, app, learning and minimized operator records',
  safety: 'isolated D9 case retention, annual review and case-specific legal holds',
  media: 'private encrypted S3 objects, including versions and delete markers',
  exports: 'encrypted registered learning snapshots; all invalidated on deletion',
  caches: 'no personal server cache; private responses use no-store',
  cdn: 'none configured; public media delivery is disabled',
  search: 'none',
  vendors: 'none with member data; SMTP delivery cannot recall a received email',
  models: 'none; no training or embeddings',
} as const;
