-- Spec P5/P6/P10/P13/P16/P22. Runtime uses ordered member and ledger locks.
CREATE TABLE app.capacity_ledger (
 member_id uuid PRIMARY KEY REFERENCES app.members(id) ON DELETE CASCADE,
 held integer NOT NULL DEFAULT 0 CHECK(held>=0), cap_limit integer NOT NULL CHECK(cap_limit>0),
 reminders boolean NOT NULL DEFAULT false, version integer NOT NULL DEFAULT 0,
 last_offer_at timestamptz
);
CREATE TABLE app.exposure_week (
 member_id uuid NOT NULL REFERENCES app.capacity_ledger(member_id) ON DELETE CASCADE,
 week date NOT NULL, delivered integer NOT NULL DEFAULT 0 CHECK(delivered>=0),
 pending integer NOT NULL DEFAULT 0 CHECK(pending>=0), version integer NOT NULL DEFAULT 0,
 PRIMARY KEY(member_id,week)
);
-- Public venue reference geometry only; never a member coordinate.
CREATE TABLE app.explore_venues (
 id uuid PRIMARY KEY, name text NOT NULL, public_centroid geography(Point,4326) NOT NULL,
 approved boolean NOT NULL DEFAULT false, review_expires_at timestamptz NOT NULL,
 alcohol_primary boolean NOT NULL DEFAULT false, synthetic boolean NOT NULL DEFAULT false
);
CREATE INDEX explore_venues_geo ON app.explore_venues USING gist(public_centroid);
CREATE TABLE app.explore_batches (
 id uuid PRIMARY KEY, seed text NOT NULL, policy text NOT NULL CHECK(policy IN ('algorithm','operator')),
 status text NOT NULL DEFAULT 'REVIEW' CHECK(status IN ('REVIEW','APPROVED')),
 version integer NOT NULL DEFAULT 0, creator_id uuid, scheduled_week date UNIQUE,
 summary_cipher text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE app.allocation_sets (
 id uuid PRIMARY KEY, batch_id uuid NOT NULL REFERENCES app.explore_batches(id),
 step integer NOT NULL, body_cipher text NOT NULL, UNIQUE(batch_id,step)
);
CREATE TRIGGER immutable_allocation_sets BEFORE UPDATE OR DELETE ON app.allocation_sets
FOR EACH ROW EXECUTE FUNCTION ops.reject_history_mutation();
CREATE TABLE app.pair_history (
 low_id uuid NOT NULL, high_id uuid NOT NULL, origin text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(low_id,high_id), CHECK(low_id<high_id)
);
INSERT INTO app.pair_history(low_id,high_id,origin)
 SELECT low_id,high_id,'LEGACY_BLOCK' FROM app.legacy_pair_denials
 UNION SELECT low_id,high_id,'BLOCK' FROM app.blocks
 ON CONFLICT DO NOTHING;
CREATE TABLE app.opportunities (
 id uuid PRIMARY KEY, batch_id uuid NOT NULL REFERENCES app.explore_batches(id),
 low_id uuid NOT NULL, high_id uuid NOT NULL, UNIQUE(low_id,high_id), CHECK(low_id<high_id),
 state text NOT NULL CHECK(state IN ('RESERVED','PROPOSED','MUTUAL','PASSED','EXPIRED','BLOCKED','RESTRICTED','CLOSED','CANCELLED')),
 version integer NOT NULL DEFAULT 0, slot_held boolean NOT NULL DEFAULT true,
 reserved_week date NOT NULL, reserve_expires_at timestamptz NOT NULL,
 proposed_at timestamptz, expires_at timestamptz, closed_at timestamptz,
 policy text NOT NULL CHECK(policy IN ('algorithm','operator')),
 policy_version text NOT NULL, feature_version text NOT NULL, feature_snapshot text NOT NULL,
 retrieval_source text NOT NULL, feasible_set_id uuid REFERENCES app.allocation_sets(id),
 feasible_size integer NOT NULL, seed text NOT NULL, step integer NOT NULL,
 q double precision, branch text NOT NULL,
 CHECK((policy='operator' AND q IS NULL) OR (policy='algorithm' AND q IS NOT NULL AND q>0 AND q<=1)),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX opportunities_low ON app.opportunities(low_id,state);
CREATE INDEX opportunities_high ON app.opportunities(high_id,state);
CREATE INDEX opportunities_batch ON app.opportunities(batch_id);
CREATE INDEX opportunities_expiry ON app.opportunities(state,expires_at,reserve_expires_at);
CREATE TABLE app.introduction_decisions (
 opportunity_id uuid NOT NULL REFERENCES app.opportunities(id), member_id uuid NOT NULL,
 decision text NOT NULL DEFAULT 'UNDECIDED' CHECK(decision IN ('UNDECIDED','ACCEPT','PASS')),
 version integer NOT NULL DEFAULT 0, decided_at timestamptz,
 PRIMARY KEY(opportunity_id,member_id)
);
CREATE TABLE app.connections (
 id uuid PRIMARY KEY REFERENCES app.opportunities(id), created_at timestamptz NOT NULL DEFAULT now(), closed_at timestamptz
);
CREATE TABLE app.introduction_outbox (
 opportunity_id uuid PRIMARY KEY REFERENCES app.opportunities(id),
 state text NOT NULL DEFAULT 'PENDING' CHECK(state IN ('PENDING','DELIVERED','CANCELLED')),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE app.introduction_mail (
 id uuid PRIMARY KEY, opportunity_id uuid NOT NULL REFERENCES app.opportunities(id), member_id uuid NOT NULL,
 kind text NOT NULL CHECK(kind IN ('INTRODUCTION','REMINDER')), UNIQUE(opportunity_id,member_id,kind),
 state text NOT NULL DEFAULT 'PENDING' CHECK(state IN ('PENDING','SENDING','SENT','CANCELLED','UNCERTAIN','FAILED')),
 attempts integer NOT NULL DEFAULT 0, next_attempt_at timestamptz NOT NULL DEFAULT now(),
 started_at timestamptz, sent_at timestamptz
);
CREATE INDEX introduction_mail_pending ON app.introduction_mail(state,next_attempt_at);
CREATE TABLE learning.introduction_exposure (
 opportunity_id uuid PRIMARY KEY, low_id uuid NOT NULL, high_id uuid NOT NULL,
 policy text NOT NULL, policy_version text NOT NULL, feature_version text NOT NULL,
 feature_snapshot text NOT NULL, retrieval_source text NOT NULL,
 feasible_set_id uuid, feasible_size integer NOT NULL, seed text NOT NULL, step integer NOT NULL,
 q double precision, branch text NOT NULL, delivered_at timestamptz NOT NULL,
 CHECK((policy='operator' AND q IS NULL) OR (policy='algorithm' AND q IS NOT NULL AND q>0 AND q<=1))
);
CREATE TABLE learning.introduction_decision (
 opportunity_id uuid NOT NULL, member_id uuid NOT NULL, decision text NOT NULL CHECK(decision IN ('ACCEPT','PASS')),
 decided_at timestamptz NOT NULL, PRIMARY KEY(opportunity_id,member_id)
);
CREATE TRIGGER immutable_exposure BEFORE UPDATE OR DELETE ON learning.introduction_exposure
FOR EACH ROW EXECUTE FUNCTION ops.reject_history_mutation();
CREATE TRIGGER immutable_intro_decision BEFORE UPDATE OR DELETE ON learning.introduction_decision
FOR EACH ROW EXECUTE FUNCTION ops.reject_history_mutation();
GRANT SELECT ON learning.introduction_exposure,learning.introduction_decision TO meetwell_learning;
GRANT SELECT ON app.explore_venues,app.pair_history TO meetwell_app;
GRANT SELECT,INSERT ON app.allocation_sets TO meetwell_app;
GRANT SELECT,INSERT,UPDATE ON app.capacity_ledger,app.exposure_week,app.explore_batches,
 app.opportunities,app.introduction_decisions,app.connections,app.introduction_outbox,app.introduction_mail TO meetwell_app;
GRANT INSERT,UPDATE,DELETE ON app.profile_access TO meetwell_app;

-- Lock reference data without granting serving credentials authority to approve venues.
CREATE FUNCTION app.lock_explore_venues() RETURNS SETOF app.explore_venues
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT * FROM app.explore_venues ORDER BY id FOR SHARE;
$$;
REVOKE ALL ON FUNCTION app.lock_explore_venues() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.lock_explore_venues() TO meetwell_app;

CREATE FUNCTION app.record_introduction_exposure(opportunity uuid) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
 INSERT INTO learning.introduction_exposure
 SELECT id,low_id,high_id,policy,policy_version,feature_version,feature_snapshot,retrieval_source,
 feasible_set_id,feasible_size,seed,step,q,branch,proposed_at FROM app.opportunities
 WHERE id=opportunity AND state='PROPOSED' ON CONFLICT DO NOTHING;
$$;
REVOKE ALL ON FUNCTION app.record_introduction_exposure(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.record_introduction_exposure(uuid) TO meetwell_app;
CREATE FUNCTION app.record_introduction_decision(opportunity uuid,actor uuid) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
 INSERT INTO learning.introduction_decision
 SELECT opportunity_id,member_id,decision,decided_at FROM app.introduction_decisions
 WHERE opportunity_id=opportunity AND member_id=actor AND decision<>'UNDECIDED' ON CONFLICT DO NOTHING;
$$;
REVOKE ALL ON FUNCTION app.record_introduction_decision(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.record_introduction_decision(uuid,uuid) TO meetwell_app;

-- Closing only removes authority. The slot_held guard makes release exactly once.
CREATE FUNCTION app.close_opportunity(opportunity uuid,reason text) RETURNS boolean
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
 UPDATE app.opportunities SET state=reason,slot_held=false,version=version+1,closed_at=clock_timestamp() WHERE id=opportunity;
 DELETE FROM app.profile_access WHERE (viewer_id=o.low_id AND subject_id=o.high_id) OR (viewer_id=o.high_id AND subject_id=o.low_id);
 UPDATE app.connections SET closed_at=clock_timestamp() WHERE id=opportunity AND closed_at IS NULL;
 UPDATE app.introduction_outbox SET state='CANCELLED' WHERE opportunity_id=opportunity AND state='PENDING';
 UPDATE app.introduction_mail SET state='CANCELLED' WHERE opportunity_id=opportunity AND state IN ('PENDING','SENDING');
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION app.close_opportunity(uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.close_opportunity(uuid,text) TO meetwell_app;
CREATE FUNCTION app.remember_opportunity_pair() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 INSERT INTO app.pair_history(low_id,high_id,origin) VALUES(NEW.low_id,NEW.high_id,'OPPORTUNITY');
 RETURN NEW;
END $$;
CREATE TRIGGER opportunity_pair_history AFTER INSERT ON app.opportunities FOR EACH ROW EXECUTE FUNCTION app.remember_opportunity_pair();
CREATE FUNCTION app.block_explore_pair() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE o record;
BEGIN
 INSERT INTO app.pair_history(low_id,high_id,origin) VALUES(NEW.low_id,NEW.high_id,'BLOCK') ON CONFLICT DO NOTHING;
 FOR o IN SELECT id FROM app.opportunities WHERE low_id=NEW.low_id AND high_id=NEW.high_id AND slot_held LOOP
  PERFORM app.close_opportunity(o.id,'BLOCKED');
 END LOOP;
 DELETE FROM app.profile_access WHERE (viewer_id=NEW.low_id AND subject_id=NEW.high_id) OR (viewer_id=NEW.high_id AND subject_id=NEW.low_id);
 RETURN NEW;
END $$;
CREATE TRIGGER block_explore AFTER INSERT ON app.blocks FOR EACH ROW EXECUTE FUNCTION app.block_explore_pair();
CREATE FUNCTION app.restrict_explore_member() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE o record;
BEGIN
 IF NEW.restricted THEN
  FOR o IN SELECT id FROM app.opportunities WHERE (low_id=NEW.member_id OR high_id=NEW.member_id) AND slot_held ORDER BY low_id,high_id LOOP
   PERFORM app.close_opportunity(o.id,'RESTRICTED');
  END LOOP;
  DELETE FROM app.profile_access WHERE viewer_id=NEW.member_id OR subject_id=NEW.member_id;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER restriction_explore AFTER INSERT OR UPDATE OF restricted ON safety.enforcement FOR EACH ROW EXECUTE FUNCTION app.restrict_explore_member();
CREATE FUNCTION app.invalidate_explore_policy() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE o record; who uuid; remove_all boolean;
BEGIN
 IF TG_OP='DELETE' THEN who=OLD.id; remove_all=true;
 ELSE who=NEW.id; remove_all=NEW.state IN ('EXITED','RESTRICTED') OR NEW.deletion_requested_at IS NOT NULL;
  IF NOT remove_all AND NEW.state=OLD.state AND NEW.intent=OLD.intent AND NEW.epoch=OLD.epoch THEN RETURN NEW; END IF;
 END IF;
 -- Fresh profile/preference snapshots are required before another proposal.
 FOR o IN SELECT id FROM app.opportunities WHERE (low_id=who OR high_id=who) AND slot_held AND
  (remove_all OR state IN ('RESERVED','PROPOSED')) ORDER BY low_id,high_id LOOP
  PERFORM app.close_opportunity(o.id,'CANCELLED');
 END LOOP;
 IF remove_all THEN DELETE FROM app.profile_access WHERE viewer_id=who OR subject_id=who; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $$;
CREATE TRIGGER policy_explore AFTER UPDATE ON app.members FOR EACH ROW EXECUTE FUNCTION app.invalidate_explore_policy();
CREATE TRIGGER deleted_member_explore BEFORE DELETE ON app.members FOR EACH ROW EXECUTE FUNCTION app.invalidate_explore_policy();

CREATE FUNCTION app.invalidate_explore_media() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE o record;
BEGIN
 IF OLD.status='APPROVED' AND NEW.status<>'APPROVED' THEN
  FOR o IN SELECT id FROM app.opportunities WHERE (low_id=NEW.member_id OR high_id=NEW.member_id)
   AND state IN ('RESERVED','PROPOSED') AND slot_held ORDER BY low_id,high_id LOOP
   PERFORM app.close_opportunity(o.id,'CANCELLED');
  END LOOP;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER media_explore AFTER UPDATE OF status ON app.media FOR EACH ROW EXECUTE FUNCTION app.invalidate_explore_media();

ALTER TABLE ops.audit DROP CONSTRAINT audit_action_check;
ALTER TABLE ops.audit ADD CHECK(action IN ('QUEUE_READ','MEDIA_READ','MEDIA_APPROVED','MEDIA_REJECTED','AUDIT_READ','STAFF_GRANTED','STAFF_REVOKED','EXPLORE_REVIEW','EXPLORE_GENERATED','EXPLORE_EDITED','EXPLORE_APPROVED'));
