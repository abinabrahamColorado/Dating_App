-- Spec P22 / I-18. Runtime roles cannot run arbitrary erasure SQL. Maintenance
-- receives bounded SECURITY DEFINER commands, never safety narratives or keys.
CREATE TABLE ops.serving_attestation (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton), database_name text NOT NULL,
 database_oid oid NOT NULL, verified_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
INSERT INTO ops.serving_attestation(database_name,database_oid)
 SELECT current_database(),oid FROM pg_database WHERE datname=current_database();
CREATE FUNCTION app.assert_serving_ready() RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM ops.serving_attestation a JOIN pg_database d ON d.oid=a.database_oid
  WHERE a.database_name=current_database() AND d.datname=current_database()) THEN
  RAISE EXCEPTION 'RESTORE_QUARANTINED' USING ERRCODE='55000';
 END IF;
END $$;
REVOKE ALL ON FUNCTION app.assert_serving_ready() FROM PUBLIC;
GRANT USAGE ON SCHEMA app TO meetwell_identity,meetwell_learning,meetwell_worker;
GRANT EXECUTE ON FUNCTION app.assert_serving_ready() TO meetwell_identity,meetwell_app,meetwell_ops,meetwell_safety,meetwell_learning,meetwell_worker;

CREATE TABLE ops.deletion_jobs (
 member_id uuid PRIMARY KEY, requested_at timestamptz NOT NULL,
 receipt_hash text UNIQUE, completed_at timestamptz,
 media_ids uuid[] NOT NULL DEFAULT '{}', journaled_at timestamptz
);
CREATE TABLE ops.lifecycle_audit (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), event text NOT NULL CHECK(event IN('ERASED','RETENTION','EXPORT','RESTORE_REPLAY')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE ops.learning_exports (
 id uuid PRIMARY KEY, created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE ops.privacy_reviews (
 kind text PRIMARY KEY CHECK(kind IN('INACTIVE','AUDIT','SAFETY')),
 due_count integer NOT NULL, oldest_at timestamptz, checked_at timestamptz NOT NULL
);
GRANT SELECT ON ops.privacy_reviews TO meetwell_ops;
GRANT SELECT ON ops.deletion_jobs TO meetwell_worker;
GRANT SELECT,INSERT,DELETE ON ops.learning_exports TO meetwell_worker;
GRANT INSERT ON ops.lifecycle_audit TO meetwell_worker;
CREATE TRIGGER immutable_lifecycle_audit BEFORE UPDATE OR DELETE ON ops.lifecycle_audit FOR EACH ROW EXECUTE FUNCTION ops.reject_history_mutation();

-- Deletion permission is bound to the migration owner inside vetted definers.
-- A custom session setting cannot bypass append-only protection. No runtime
-- role owns these tables or can SET ROLE to their owner.
CREATE OR REPLACE FUNCTION ops.reject_history_mutation() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF TG_OP='DELETE' AND current_user=(SELECT pg_get_userbyid(relowner) FROM pg_class WHERE oid=TG_RELID) THEN RETURN OLD; END IF;
 RAISE EXCEPTION 'History is append only' USING ERRCODE='42501';
END $$;
CREATE FUNCTION app.request_erasure(who uuid,receipt text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF length(receipt)<>64 OR NOT EXISTS(SELECT 1 FROM app.members WHERE id=who AND deletion_requested_at IS NOT NULL) THEN RAISE EXCEPTION 'Not an erasure request'; END IF;
 INSERT INTO ops.deletion_jobs(member_id,requested_at,receipt_hash,media_ids)
 SELECT who,deletion_requested_at,receipt,ARRAY(SELECT id FROM app.media WHERE member_id=who) FROM app.members WHERE id=who
 ON CONFLICT(member_id) DO UPDATE SET receipt_hash=coalesce(ops.deletion_jobs.receipt_hash,excluded.receipt_hash);
END $$;
REVOKE ALL ON FUNCTION app.request_erasure(uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.request_erasure(uuid,text) TO meetwell_app;
INSERT INTO ops.deletion_jobs(member_id,requested_at,media_ids)
 SELECT id,deletion_requested_at,ARRAY(SELECT m.id FROM app.media m WHERE m.member_id=a.id)
 FROM app.members a WHERE deletion_requested_at IS NOT NULL;
CREATE FUNCTION app.capture_erasure() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF NEW.deletion_requested_at IS NOT NULL THEN
  INSERT INTO ops.deletion_jobs(member_id,requested_at,media_ids)
  VALUES(NEW.id,NEW.deletion_requested_at,ARRAY(SELECT id FROM app.media WHERE member_id=NEW.id)) ON CONFLICT DO NOTHING;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER capture_erasure AFTER UPDATE OF deletion_requested_at ON app.members FOR EACH ROW EXECUTE FUNCTION app.capture_erasure();
CREATE FUNCTION app.prevent_erased_identity_reuse() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM ops.deletion_jobs WHERE member_id=NEW.id) THEN RAISE EXCEPTION 'Identifier retired'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER erased_identity_reuse BEFORE INSERT ON identity.users FOR EACH ROW EXECUTE FUNCTION app.prevent_erased_identity_reuse();
CREATE TRIGGER erased_member_reuse BEFORE INSERT ON app.members FOR EACH ROW EXECUTE FUNCTION app.prevent_erased_identity_reuse();
CREATE FUNCTION app.erasure_receipt(receipt text) RETURNS TABLE(requested_at timestamptz,completed_at timestamptz)
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT requested_at,completed_at FROM ops.deletion_jobs WHERE receipt_hash=receipt;
$$;
REVOKE ALL ON FUNCTION app.erasure_receipt(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.erasure_receipt(text) TO meetwell_app;

ALTER TABLE safety.integrity_signal ADD COLUMN closed_at timestamptz;
ALTER TABLE safety.appeal ADD COLUMN closed_at timestamptz;
ALTER TABLE safety.report ADD COLUMN reviewed_at timestamptz;
ALTER TABLE safety.integrity_signal ADD COLUMN reviewed_at timestamptz;
ALTER TABLE safety.appeal ADD COLUMN reviewed_at timestamptz;
-- Historical closure timestamps were not recorded. Begin their retention clock
-- at migration rather than inventing an earlier event.
UPDATE safety.integrity_signal SET closed_at=clock_timestamp() WHERE status='CLOSED';
UPDATE safety.appeal SET closed_at=clock_timestamp() WHERE status<>'OPEN';
CREATE FUNCTION safety.capture_closure() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF NEW.status IN('CLOSED','UPHELD','LIFTED') THEN NEW.closed_at=coalesce(NEW.closed_at,clock_timestamp());
 ELSE NEW.closed_at=NULL; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER integrity_closure BEFORE UPDATE ON safety.integrity_signal FOR EACH ROW EXECUTE FUNCTION safety.capture_closure();
CREATE TRIGGER appeal_closure BEFORE UPDATE ON safety.appeal FOR EACH ROW EXECUTE FUNCTION safety.capture_closure();
CREATE TABLE safety.legal_holds (
 kind text NOT NULL CHECK(kind IN('report','integrity','appeal')), record_id uuid NOT NULL,
 reason_cipher text NOT NULL, actor_id uuid NOT NULL, until_at timestamptz NOT NULL,
 review_at timestamptz NOT NULL, updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 released_at timestamptz, version integer NOT NULL DEFAULT 0,
 PRIMARY KEY(kind,record_id), CHECK(review_at<=until_at)
);
GRANT SELECT,INSERT,UPDATE ON safety.legal_holds TO meetwell_safety;

-- Internal FK-ordered erasure helper. These are closed connections only; no
-- caller can invoke it directly. Encounter feedback is retained independently
-- until its D8 deadline unless a member explicitly requests erasure.
CREATE FUNCTION ops.purge_connection(which uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 DELETE FROM app.messages WHERE connection_id=which;
 DELETE FROM app.planning_preferences WHERE connection_id=which;
 DELETE FROM app.plan_options WHERE connection_id=which;
 DELETE FROM app.plan_confirmations WHERE plan_id IN(SELECT id FROM app.plans WHERE connection_id=which);
 DELETE FROM app.plan_versions WHERE plan_id IN(SELECT id FROM app.plans WHERE connection_id=which);
 DELETE FROM app.plans WHERE connection_id=which;
END $$;
REVOKE ALL ON FUNCTION ops.purge_connection(uuid) FROM PUBLIC;

CREATE FUNCTION ops.erase_primary(who uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE o record; encounters uuid[]; opportunities uuid[]; email_key text;
BEGIN
 PERFORM pg_advisory_xact_lock(55,2);
 IF NOT EXISTS(SELECT 1 FROM ops.deletion_jobs WHERE member_id=who AND journaled_at IS NOT NULL) THEN RAISE EXCEPTION 'Durable tombstone required'; END IF;
 SELECT array_agg(id) INTO opportunities FROM app.opportunities WHERE who IN(low_id,high_id);
 SELECT array_agg(id) INTO encounters FROM app.encounters WHERE who IN(low_id,high_id);
 FOR o IN SELECT * FROM app.opportunities WHERE id=ANY(opportunities) ORDER BY low_id,high_id LOOP
  PERFORM app.lock_pair(o.low_id,o.high_id);
  PERFORM app.close_opportunity(o.id,CASE WHEN o.state='MUTUAL' THEN 'CLOSED' ELSE 'CANCELLED' END);
  PERFORM ops.purge_connection(o.id);
 END LOOP;
 DELETE FROM learning.experience WHERE member_id=who OR encounter_id=ANY(encounters);
 DELETE FROM learning.logistics WHERE who IN(low_id,high_id);
 DELETE FROM learning.introduction_decision WHERE member_id=who OR opportunity_id=ANY(opportunities);
 DELETE FROM learning.introduction_exposure WHERE who IN(low_id,high_id);
 DELETE FROM app.matching_feedback WHERE member_id=who OR encounter_id=ANY(encounters);
 DELETE FROM app.feedback_prompts WHERE member_id=who OR encounter_id=ANY(encounters);
 DELETE FROM app.encounters WHERE id=ANY(encounters);
 DELETE FROM app.second_meeting_reports WHERE member_id=who OR connection_id=ANY(opportunities);
 DELETE FROM app.outcome_followups WHERE member_id=who;
 DELETE FROM app.success_exits WHERE member_id=who;
 DELETE FROM app.attention_minutes WHERE member_id=who;
 DELETE FROM app.attention_consent WHERE member_id=who;
 DELETE FROM app.introduction_mail WHERE member_id=who OR opportunity_id=ANY(opportunities);
 DELETE FROM app.introduction_outbox WHERE opportunity_id=ANY(opportunities);
 DELETE FROM app.introduction_decisions WHERE member_id=who OR opportunity_id=ANY(opportunities);
 DELETE FROM app.opportunity_closures WHERE opportunity_id=ANY(opportunities);
 DELETE FROM app.connections WHERE id=ANY(opportunities);
 DELETE FROM app.opportunities WHERE id=ANY(opportunities);
 DELETE FROM app.profile_access WHERE viewer_id=who OR subject_id=who;
 -- Encrypted feasible sets and summaries can include non-selected members.
 -- Lifecycle code scrubs affected batches before invoking this function.
 IF EXISTS(SELECT 1 FROM app.explore_batches WHERE creator_id=who) THEN
  UPDATE app.explore_batches SET creator_id=NULL WHERE creator_id=who;
 END IF;
 DELETE FROM app.command_receipts; -- can contain another member's introduction; conservative pilot invalidation
 DELETE FROM ops.moderation_receipts;
 DELETE FROM ops.venue_receipts WHERE actor_id=who;
 DELETE FROM app.media WHERE member_id=who;
 DELETE FROM app.preference_versions WHERE member_id=who;
 DELETE FROM app.profiles WHERE member_id=who;
 DELETE FROM app.members WHERE id=who;
 SELECT email_lookup INTO email_key FROM identity.users WHERE id=who;
 DELETE FROM identity.magic_links WHERE email_lookup=email_key;
 DELETE FROM identity.challenges WHERE member_id=who OR session_id IN(SELECT id FROM identity.sessions WHERE member_id=who);
 DELETE FROM identity.sessions WHERE member_id=who;
 DELETE FROM identity.passkeys WHERE member_id=who;
 DELETE FROM identity.consents WHERE member_id=who;
 DELETE FROM identity.users WHERE id=who;
 DELETE FROM identity.rate_limits; -- bounded counters may embed opaque member IDs
 DELETE FROM ops.staff WHERE member_id=who;
 DELETE FROM ops.readiness_reviews WHERE actor_id=who;
 DELETE FROM ops.audit WHERE actor_id=who OR subject_id=who OR subject_id=ANY(opportunities);
 DELETE FROM ops.audit WHERE subject_id IN(SELECT unnest(media_ids) FROM ops.deletion_jobs WHERE member_id=who);
 DELETE FROM ops.metric_members WHERE member_id=who;
 DELETE FROM ops.metric_snapshots; -- recompute from remaining rows; fixed cohort denominators are immutable
 DELETE FROM safety.command_receipts WHERE actor_id=who;
 -- D9 case payloads stay only in the safety boundary, reviewed and time bounded.
 UPDATE ops.deletion_jobs SET completed_at=clock_timestamp() WHERE member_id=who;
 INSERT INTO ops.lifecycle_audit(event) VALUES('ERASED');
END $$;
REVOKE ALL ON FUNCTION ops.erase_primary(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ops.erase_primary(uuid) TO meetwell_worker;
CREATE FUNCTION ops.mark_journaled(who uuid) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
 UPDATE ops.deletion_jobs SET journaled_at=clock_timestamp() WHERE member_id=who;
$$;
REVOKE ALL ON FUNCTION ops.mark_journaled(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ops.mark_journaled(uuid) TO meetwell_worker;

-- Only encrypted batch payloads cross to the dedicated maintenance process;
-- they are not a serving, learning or operator API.
CREATE FUNCTION ops.erasure_batches() RETURNS TABLE(id uuid,summary_cipher text)
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$ SELECT id,summary_cipher FROM app.explore_batches; $$;
CREATE FUNCTION ops.scrub_erasure_batch(batch uuid,scrubbed text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 UPDATE app.opportunities SET feasible_set_id=NULL WHERE batch_id=batch;
 DELETE FROM app.allocation_sets WHERE batch_id=batch;
 UPDATE app.explore_batches SET summary_cipher=scrubbed WHERE id=batch;
END $$;
REVOKE ALL ON FUNCTION ops.erasure_batches(),ops.scrub_erasure_batch(uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ops.erasure_batches(),ops.scrub_erasure_batch(uuid,text) TO meetwell_worker;

CREATE FUNCTION ops.retain_until(cutoffs jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE o record; expired uuid[];
BEGIN
 PERFORM pg_advisory_xact_lock(55,2);
 IF EXISTS(SELECT 1 FROM jsonb_each_text(cutoffs) WHERE value::timestamptz>clock_timestamp()) THEN RAISE EXCEPTION 'Invalid retention cutoff'; END IF;
 DELETE FROM learning.introduction_decision WHERE decided_at<(cutoffs->>'learning')::timestamptz;
 DELETE FROM learning.introduction_exposure WHERE delivered_at<(cutoffs->>'learning')::timestamptz;
 DELETE FROM learning.experience WHERE observed_at<(cutoffs->>'feedback')::timestamptz;
 DELETE FROM learning.logistics WHERE occurred_at<(cutoffs->>'learning')::timestamptz;
 SELECT array_agg(id) INTO expired FROM app.encounters WHERE start_at<(cutoffs->>'feedback')::timestamptz;
 DELETE FROM app.matching_feedback WHERE encounter_id=ANY(expired);
 DELETE FROM app.feedback_prompts WHERE encounter_id=ANY(expired);
 DELETE FROM app.encounters WHERE id=ANY(expired);
 DELETE FROM app.second_meeting_reports WHERE created_at<(cutoffs->>'feedback')::timestamptz;
 DELETE FROM app.outcome_followups WHERE due_at<(cutoffs->>'feedback')::timestamptz;
 DELETE FROM app.success_exits WHERE created_at<(cutoffs->>'feedback')::timestamptz
  AND NOT EXISTS(SELECT 1 FROM app.outcome_followups WHERE member_id=app.success_exits.member_id);
 DELETE FROM app.attention_minutes WHERE minute<(cutoffs->>'counters')::timestamptz;
 DELETE FROM identity.rate_limits WHERE window_start<(cutoffs->>'counters')::timestamptz;
 DELETE FROM identity.challenges WHERE expires_at<clock_timestamp();
 DELETE FROM identity.magic_links WHERE expires_at<(cutoffs->>'logs')::timestamptz;
 DELETE FROM identity.sessions WHERE expires_at<(cutoffs->>'counters')::timestamptz
  AND NOT EXISTS(SELECT 1 FROM identity.challenges WHERE session_id=identity.sessions.id);
 DELETE FROM app.command_receipts WHERE created_at<(cutoffs->>'counters')::timestamptz;
 DELETE FROM app.messages WHERE connection_id IN(SELECT id FROM app.connections WHERE closed_at<(cutoffs->>'chat')::timestamptz);
 FOR o IN SELECT id FROM app.connections WHERE closed_at<(cutoffs->>'plans')::timestamptz LOOP PERFORM ops.purge_connection(o.id); END LOOP;
 -- Remove closed plan linkage even while the connection stays open.
 DELETE FROM app.plan_confirmations WHERE plan_id IN(SELECT id FROM app.plans WHERE state IN('DECLINED','CANCELLED','INVALIDATED') AND updated_at<(cutoffs->>'plans')::timestamptz);
 DELETE FROM app.plan_versions WHERE plan_id IN(SELECT id FROM app.plans WHERE state IN('DECLINED','CANCELLED','INVALIDATED') AND updated_at<(cutoffs->>'plans')::timestamptz);
 DELETE FROM app.plans WHERE state IN('DECLINED','CANCELLED','INVALIDATED') AND updated_at<(cutoffs->>'plans')::timestamptz;
 DELETE FROM app.plan_options WHERE created_at<(cutoffs->>'plans')::timestamptz;
 -- A completed planned interval is the retention closure even if the members
 -- keep chatting. Do not retain an old venue/time forever in an open connection.
 SELECT array_agg(p.id) INTO expired FROM app.plans p JOIN app.plan_versions v ON v.plan_id=p.id AND v.revision=p.revision
  WHERE v.start_at+v.minutes*interval '1 minute'<(cutoffs->>'plans')::timestamptz;
 DELETE FROM app.plan_confirmations WHERE plan_id=ANY(expired);
 DELETE FROM app.plan_versions WHERE plan_id=ANY(expired);
 DELETE FROM app.plans WHERE id=ANY(expired);
 -- Feasibility snapshots and batch membership are identifiable D5 payloads.
 -- Keep live connections intact; remove closed attempt payloads on the rolling TTL.
 FOR o IN SELECT b.id FROM app.explore_batches b WHERE b.created_at<(cutoffs->>'learning')::timestamptz
  AND NOT EXISTS(SELECT 1 FROM app.opportunities p WHERE p.batch_id=b.id AND p.slot_held) LOOP
  SELECT array_agg(id) INTO expired FROM app.opportunities WHERE batch_id=o.id;
  PERFORM ops.purge_connection(id) FROM app.connections WHERE id=ANY(expired);
  DELETE FROM app.second_meeting_reports WHERE connection_id=ANY(expired);
  DELETE FROM app.introduction_mail WHERE opportunity_id=ANY(expired);
  DELETE FROM app.introduction_outbox WHERE opportunity_id=ANY(expired);
  DELETE FROM app.introduction_decisions WHERE opportunity_id=ANY(expired);
  DELETE FROM app.opportunity_closures WHERE opportunity_id=ANY(expired);
  DELETE FROM app.connections WHERE id=ANY(expired);
  DELETE FROM app.opportunities WHERE id=ANY(expired);
  DELETE FROM app.allocation_sets WHERE batch_id=o.id;
  DELETE FROM app.explore_batches WHERE id=o.id;
 END LOOP;

 SELECT array_agg(r.id) INTO expired FROM safety.report r WHERE r.closed_at<(cutoffs->>'safety')::timestamptz
  AND NOT EXISTS(SELECT 1 FROM safety.legal_holds h WHERE h.kind='report' AND h.record_id=r.id AND h.released_at IS NULL AND h.until_at>clock_timestamp());
 UPDATE safety.enforcement SET case_id=NULL WHERE case_id=ANY(expired);
 DELETE FROM safety.safety_signal WHERE report_id=ANY(expired);
 DELETE FROM safety.case_access_audit WHERE record_id=ANY(expired);
 DELETE FROM safety.legal_holds WHERE kind='report' AND record_id=ANY(expired);
 DELETE FROM safety.report WHERE id=ANY(expired);
 SELECT array_agg(r.id) INTO expired FROM safety.integrity_signal r WHERE r.closed_at<(cutoffs->>'safety')::timestamptz
  AND NOT EXISTS(SELECT 1 FROM safety.legal_holds h WHERE h.kind='integrity' AND h.record_id=r.id AND h.released_at IS NULL AND h.until_at>clock_timestamp());
 DELETE FROM safety.case_access_audit WHERE record_id=ANY(expired);
 DELETE FROM safety.legal_holds WHERE kind='integrity' AND record_id=ANY(expired);
 DELETE FROM safety.integrity_signal WHERE id=ANY(expired);
 SELECT array_agg(r.id) INTO expired FROM safety.appeal r WHERE r.closed_at<(cutoffs->>'safety')::timestamptz
  AND NOT EXISTS(SELECT 1 FROM safety.legal_holds h WHERE h.kind='appeal' AND h.record_id=r.id AND h.released_at IS NULL AND h.until_at>clock_timestamp());
 DELETE FROM safety.case_access_audit WHERE record_id=ANY(expired);
 DELETE FROM safety.legal_holds WHERE kind='appeal' AND record_id=ANY(expired);
 DELETE FROM safety.appeal WHERE id=ANY(expired);
 DELETE FROM safety.command_receipts; -- old encrypted case views cannot outlive the case
 -- Necessary opaque denial keys survive while either identity exists (DEC-007).
 -- After both are gone, wait out every supported backup before removing keys.
 DELETE FROM app.blocks b WHERE NOT EXISTS(SELECT 1 FROM app.members m WHERE m.id IN(b.low_id,b.high_id))
  AND EXISTS(SELECT 1 FROM ops.deletion_jobs WHERE member_id=b.low_id AND completed_at<(cutoffs->>'backups')::timestamptz)
  AND EXISTS(SELECT 1 FROM ops.deletion_jobs WHERE member_id=b.high_id AND completed_at<(cutoffs->>'backups')::timestamptz);
 DELETE FROM app.pair_history b WHERE NOT EXISTS(SELECT 1 FROM app.members m WHERE m.id IN(b.low_id,b.high_id))
  AND EXISTS(SELECT 1 FROM ops.deletion_jobs WHERE member_id=b.low_id AND completed_at<(cutoffs->>'backups')::timestamptz)
  AND EXISTS(SELECT 1 FROM ops.deletion_jobs WHERE member_id=b.high_id AND completed_at<(cutoffs->>'backups')::timestamptz);
 DELETE FROM app.legacy_pair_denials b WHERE NOT EXISTS(SELECT 1 FROM app.members m WHERE m.id IN(b.low_id,b.high_id))
  AND EXISTS(SELECT 1 FROM ops.deletion_jobs WHERE member_id=b.low_id AND completed_at<(cutoffs->>'backups')::timestamptz)
  AND EXISTS(SELECT 1 FROM ops.deletion_jobs WHERE member_id=b.high_id AND completed_at<(cutoffs->>'backups')::timestamptz);
 DELETE FROM safety.enforcement e WHERE NOT EXISTS(SELECT 1 FROM app.members WHERE id=e.member_id)
  AND NOT EXISTS(SELECT 1 FROM safety.report WHERE subject_id=e.member_id)
  AND NOT EXISTS(SELECT 1 FROM safety.appeal WHERE member_id=e.member_id);
 INSERT INTO ops.privacy_reviews(kind,due_count,oldest_at,checked_at)
  SELECT 'INACTIVE',count(*),min(m.created_at),clock_timestamp() FROM app.members m WHERE m.created_at<(cutoffs->>'inactiveReview')::timestamptz
   AND NOT EXISTS(SELECT 1 FROM identity.sessions s WHERE s.member_id=m.id AND s.authenticated_at>=(cutoffs->>'inactiveReview')::timestamptz)
  ON CONFLICT(kind) DO UPDATE SET due_count=excluded.due_count,oldest_at=excluded.oldest_at,checked_at=excluded.checked_at;
 INSERT INTO ops.privacy_reviews(kind,due_count,oldest_at,checked_at)
  SELECT 'AUDIT',count(*),min(created_at),clock_timestamp() FROM ops.audit WHERE created_at<(cutoffs->>'auditReview')::timestamptz
  ON CONFLICT(kind) DO UPDATE SET due_count=excluded.due_count,oldest_at=excluded.oldest_at,checked_at=excluded.checked_at;
 INSERT INTO ops.privacy_reviews(kind,due_count,oldest_at,checked_at)
  SELECT 'SAFETY',count(*),min(due),clock_timestamp() FROM (
    SELECT coalesce(reviewed_at,created_at) due FROM safety.report UNION ALL
    SELECT coalesce(reviewed_at,created_at) FROM safety.integrity_signal UNION ALL
    SELECT coalesce(reviewed_at,created_at) FROM safety.appeal
  ) reviews WHERE due<(cutoffs->>'safetyReview')::timestamptz
  ON CONFLICT(kind) DO UPDATE SET due_count=excluded.due_count,oldest_at=excluded.oldest_at,checked_at=excluded.checked_at;
 UPDATE ops.privacy_reviews SET due_count=due_count+(SELECT count(*) FROM safety.legal_holds
  WHERE released_at IS NULL AND until_at>clock_timestamp() AND review_at<=clock_timestamp()) WHERE kind='SAFETY';
 INSERT INTO ops.lifecycle_audit(event) VALUES('RETENTION');
END $$;
REVOKE ALL ON FUNCTION ops.retain_until(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ops.retain_until(jsonb) TO meetwell_worker;

CREATE FUNCTION ops.learning_snapshot() RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object(
 'selectionExposures',coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM (
  SELECT opportunity_id,low_id,high_id,policy,policy_version,feature_version,feature_snapshot,retrieval_source,
   feasible_set_id,feasible_size,seed,step,q,branch,delivered_at FROM learning.introduction_exposure ORDER BY opportunity_id) x),'[]'::jsonb),
 'selectionDecisions',coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM (
  SELECT opportunity_id,member_id,decision,decided_at FROM learning.introduction_decision ORDER BY opportunity_id,member_id) x),'[]'::jsonb),
 'experience',coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM (
  SELECT encounter_id,member_id,event,met,again,chips,observed_at FROM learning.experience ORDER BY encounter_id,member_id,event) x),'[]'::jsonb),
 'logistics',coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM (
  SELECT id,encounter_id,low_id,high_id,event,provenance,attended,occurred_at FROM learning.logistics ORDER BY id) x),'[]'::jsonb)
 );
$$;
REVOKE ALL ON FUNCTION ops.learning_snapshot() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ops.learning_snapshot() TO meetwell_worker;
CREATE FUNCTION ops.media_inventory() RETURNS TABLE(id uuid,status text) LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT id,status FROM app.media;
$$;
REVOKE ALL ON FUNCTION ops.media_inventory() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ops.media_inventory() TO meetwell_worker;
