-- Spec P5/P10, I-05, DEC-045. Attempts are not refusals. Keep every opportunity,
-- exposure and decision; only a qualifying closure creates permanent exclusion.
DROP TRIGGER opportunity_pair_history ON app.opportunities;
DROP FUNCTION app.remember_opportunity_pair();
ALTER TABLE app.opportunities DROP CONSTRAINT opportunities_low_id_high_id_key;
CREATE UNIQUE INDEX opportunities_live_pair ON app.opportunities(low_id,high_id) WHERE slot_held;

-- Non-permanent, append-only closure ledger, separate from the exclusion index.
CREATE TABLE app.opportunity_closures (
 opportunity_id uuid PRIMARY KEY REFERENCES app.opportunities(id),
 low_id uuid NOT NULL, high_id uuid NOT NULL, prior_state text NOT NULL,
 reason text NOT NULL, delivered boolean NOT NULL, closed_at timestamptz NOT NULL,
 CHECK(low_id<high_id)
);
CREATE INDEX opportunity_closures_pair ON app.opportunity_closures(low_id,high_id);
GRANT SELECT ON app.opportunity_closures TO meetwell_app;
CREATE TRIGGER immutable_opportunity_closures BEFORE UPDATE OR DELETE ON app.opportunity_closures
FOR EACH ROW EXECUTE FUNCTION ops.reject_history_mutation();

CREATE FUNCTION app.permanent_pair_closure(reason text,prior_state text,delivered boolean) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT reason IN ('PASSED','BLOCKED','RESTRICTED','OPERATOR_REMOVED')
  OR (reason='EXPIRED' AND delivered) OR (reason='CLOSED' AND prior_state='MUTUAL');
$$;
REVOKE ALL ON FUNCTION app.permanent_pair_closure(text,text,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.permanent_pair_closure(text,text,boolean) TO meetwell_app;

-- Old CANCELLED rows did not distinguish operator removal from invalidation.
-- Preserve this uncertainty in the ledger rather than invent a member refusal.
INSERT INTO app.opportunity_closures
 SELECT o.id,o.low_id,o.high_id,
  CASE WHEN c.id IS NOT NULL THEN 'MUTUAL' WHEN o.proposed_at IS NOT NULL THEN 'PROPOSED' ELSE 'RESERVED' END,
  CASE WHEN o.state='CANCELLED' THEN 'LEGACY_CANCELLED' ELSE o.state END,
  o.proposed_at IS NOT NULL,coalesce(o.closed_at,o.created_at)
 FROM app.opportunities o LEFT JOIN app.connections c ON c.id=o.id WHERE NOT o.slot_held;
DELETE FROM app.pair_history WHERE origin='OPPORTUNITY';
INSERT INTO app.pair_history(low_id,high_id,origin)
 SELECT low_id,high_id,reason FROM app.opportunity_closures
 WHERE app.permanent_pair_closure(reason,prior_state,delivered)
 UNION SELECT low_id,high_id,'BLOCK' FROM app.blocks
 UNION SELECT low_id,high_id,'LEGACY_BLOCK' FROM app.legacy_pair_denials
 ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION app.close_opportunity(opportunity uuid,reason text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE o app.opportunities%ROWTYPE; ended_at timestamptz;
BEGIN
 IF reason NOT IN ('PASSED','EXPIRED','BLOCKED','RESTRICTED','CLOSED','CANCELLED','OPERATOR_REMOVED') THEN RAISE EXCEPTION 'Invalid closure'; END IF;
 SELECT * INTO o FROM app.opportunities WHERE id=opportunity FOR UPDATE;
 IF NOT FOUND OR NOT o.slot_held THEN RETURN false; END IF;
 ended_at=clock_timestamp();
 PERFORM member_id FROM app.capacity_ledger WHERE member_id IN(o.low_id,o.high_id) ORDER BY member_id FOR UPDATE;
 UPDATE app.capacity_ledger SET held=held-1,version=version+1 WHERE member_id IN(o.low_id,o.high_id);
 IF o.state='RESERVED' THEN
  UPDATE app.exposure_week SET pending=pending-1,version=version+1 WHERE member_id IN(o.low_id,o.high_id) AND week=o.reserved_week;
 END IF;
 UPDATE app.opportunities SET state=CASE WHEN reason='OPERATOR_REMOVED' THEN 'CANCELLED' ELSE reason END,
  slot_held=false,version=version+1,closed_at=ended_at WHERE id=opportunity AND version=o.version AND slot_held;
 IF NOT FOUND THEN RAISE EXCEPTION 'Stale opportunity version'; END IF;
 INSERT INTO app.opportunity_closures VALUES(o.id,o.low_id,o.high_id,o.state,reason,o.proposed_at IS NOT NULL,ended_at);
 IF app.permanent_pair_closure(reason,o.state,o.proposed_at IS NOT NULL) THEN
  INSERT INTO app.pair_history(low_id,high_id,origin,created_at) VALUES(o.low_id,o.high_id,reason,ended_at) ON CONFLICT DO NOTHING;
 END IF;
 DELETE FROM app.profile_access WHERE (viewer_id=o.low_id AND subject_id=o.high_id) OR (viewer_id=o.high_id AND subject_id=o.low_id);
 UPDATE app.connections SET closed_at=ended_at WHERE id=opportunity AND closed_at IS NULL;
 UPDATE app.introduction_outbox SET state='CANCELLED' WHERE opportunity_id=opportunity AND state='PENDING';
 UPDATE app.introduction_mail SET state='CANCELLED' WHERE opportunity_id=opportunity AND state IN ('PENDING','SENDING');
 RETURN true;
END $$;

CREATE OR REPLACE FUNCTION app.invalidate_explore_policy() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE o record; who uuid; remove_all boolean; restricted_now boolean=false;
BEGIN
 IF TG_OP='DELETE' THEN who=OLD.id; remove_all=true;
 ELSE who=NEW.id; restricted_now=NEW.state='RESTRICTED';
  remove_all=NEW.state IN ('EXITED','RESTRICTED') OR NEW.deletion_requested_at IS NOT NULL;
  IF NOT remove_all AND NEW.state=OLD.state AND NEW.intent=OLD.intent AND NEW.epoch=OLD.epoch THEN RETURN NEW; END IF;
 END IF;
 FOR o IN SELECT id,state FROM app.opportunities WHERE (low_id=who OR high_id=who) AND slot_held AND
  (remove_all OR state IN ('RESERVED','PROPOSED')) ORDER BY low_id,high_id LOOP
  PERFORM app.close_opportunity(o.id,CASE WHEN restricted_now THEN 'RESTRICTED' WHEN o.state='MUTUAL' THEN 'CLOSED' ELSE 'CANCELLED' END);
 END LOOP;
 IF remove_all THEN DELETE FROM app.profile_access WHERE viewer_id=who OR subject_id=who; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $$;
