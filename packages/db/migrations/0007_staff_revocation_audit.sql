-- Spec P21/P22: local administrative revocations have an explicit audit action.
ALTER TABLE ops.audit DROP CONSTRAINT audit_action_check;
ALTER TABLE ops.audit ADD CONSTRAINT audit_action_check CHECK(action IN
 ('QUEUE_READ','MEDIA_READ','MEDIA_APPROVED','MEDIA_REJECTED','AUDIT_READ','STAFF_GRANTED','STAFF_REVOKED'));
CREATE INDEX ON safety.case_access_audit(created_at DESC,id);
CREATE INDEX ON safety.case_access_audit(record_id,created_at);
