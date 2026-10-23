-- Spec P5/P6, I-09: explicit compare-and-swap in the shared closure path.
CREATE OR REPLACE FUNCTION app.close_opportunity(opportunity uuid,reason text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE o app.opportunities%ROWTYPE;
BEGIN
 IF reason NOT IN ('PASSED','EXPIRED','BLOCKED','RESTRICTED','CLOSED','CANCELLED') THEN RAISE EXCEPTION 'Invalid closure'; END IF;
 SELECT * INTO o FROM app.opportunities WHERE id=opportunity FOR UPDATE;
 IF NOT FOUND OR NOT o.slot_held THEN RETURN false; END IF;
 PERFORM member_id FROM app.capacity_ledger WHERE member_id IN(o.low_id,o.high_id) ORDER BY member_id FOR UPDATE;
 UPDATE app.capacity_ledger SET held=held-1,version=version+1 WHERE member_id IN(o.low_id,o.high_id);
 IF o.state='RESERVED' THEN
  UPDATE app.exposure_week SET pending=pending-1,version=version+1 WHERE member_id IN(o.low_id,o.high_id) AND week=o.reserved_week;
 END IF;
 UPDATE app.opportunities SET state=reason,slot_held=false,version=version+1,closed_at=clock_timestamp() WHERE id=opportunity AND version=o.version AND slot_held;
 IF NOT FOUND THEN RAISE EXCEPTION 'Stale opportunity version'; END IF;
 DELETE FROM app.profile_access WHERE (viewer_id=o.low_id AND subject_id=o.high_id) OR (viewer_id=o.high_id AND subject_id=o.low_id);
 UPDATE app.connections SET closed_at=clock_timestamp() WHERE id=opportunity AND closed_at IS NULL;
 UPDATE app.introduction_outbox SET state='CANCELLED' WHERE opportunity_id=opportunity AND state='PENDING';
 UPDATE app.introduction_mail SET state='CANCELLED' WHERE opportunity_id=opportunity AND state IN ('PENDING','SENDING');
 RETURN true;
END $$;
