-- Spec P22 / I-12 I-18 I-20 / DEC-007 update (DEC-059).
-- Only the existing keyed email lookup and its finite expiry survive here.
CREATE TABLE safety.rejoin_denials (
 email_lookup text PRIMARY KEY CHECK(email_lookup ~ '^[a-f0-9]{64}$'),
 expires_at timestamptz NOT NULL
);
CREATE INDEX ON safety.rejoin_denials(expires_at);
GRANT SELECT ON safety.rejoin_denials TO meetwell_safety;

-- No raw email, member ID, case ID, reason or narrative crosses this boundary.
CREATE FUNCTION identity.signup_denied(email_key text) RETURNS boolean
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT EXISTS(SELECT 1 FROM safety.rejoin_denials WHERE email_lookup=email_key AND expires_at>clock_timestamp());
$$;
REVOKE ALL ON FUNCTION identity.signup_denied(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION identity.signup_denied(text) TO meetwell_identity;

CREATE FUNCTION safety.remember_enforced_email(who uuid,retention_months integer) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF retention_months IS NULL OR retention_months<=0 THEN RAISE EXCEPTION 'Invalid retention policy'; END IF;
 INSERT INTO safety.rejoin_denials(email_lookup,expires_at)
 SELECT u.email_lookup,((j.requested_at AT TIME ZONE 'UTC')+make_interval(months=>retention_months)) AT TIME ZONE 'UTC'
 FROM identity.users u JOIN ops.deletion_jobs j ON j.member_id=u.id
 JOIN safety.enforcement e ON e.member_id=u.id AND e.restricted
 WHERE u.id=who AND (((j.requested_at AT TIME ZONE 'UTC')+make_interval(months=>retention_months)) AT TIME ZONE 'UTC')>clock_timestamp()
 ON CONFLICT(email_lookup) DO UPDATE SET expires_at=excluded.expires_at
 WHERE safety.rejoin_denials.expires_at<=clock_timestamp();
 -- Only a new enforced deletion after expiry can start another finite period.
END $$;
REVOKE ALL ON FUNCTION safety.remember_enforced_email(uuid,integer) FROM PUBLIC;

-- Guard direct identity writes too. Shared privacy lock serializes insertion
-- with the exclusive erasure transaction, even outside AccountStore callers.
CREATE FUNCTION identity.guard_rejoin() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 PERFORM pg_advisory_xact_lock_shared(55,2);
 IF identity.signup_denied(NEW.email_lookup) THEN RAISE EXCEPTION 'INVALID_LINK' USING ERRCODE='42501'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION identity.guard_rejoin() FROM PUBLIC;
CREATE TRIGGER guard_rejoin BEFORE INSERT OR UPDATE OF email_lookup ON identity.users
 FOR EACH ROW EXECUTE FUNCTION identity.guard_rejoin();

CREATE FUNCTION ops.expire_rejoin_denials() RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
 DELETE FROM safety.rejoin_denials WHERE expires_at<=clock_timestamp();
$$;
REVOKE ALL ON FUNCTION ops.expire_rejoin_denials() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ops.expire_rejoin_denials() TO meetwell_worker;

-- A narrowly defined erasure redaction; runtime roles still cannot update or
-- delete audit history, and even the owner cannot rewrite actions or timestamps.
CREATE OR REPLACE FUNCTION ops.reject_history_mutation() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF current_user=(SELECT pg_get_userbyid(relowner) FROM pg_class WHERE oid=TG_RELID) THEN
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  IF TG_OP='UPDATE' AND TG_RELID='ops.audit'::regclass THEN
   IF NEW.subject_id IS NULL AND (to_jsonb(NEW)-'subject_id')=(to_jsonb(OLD)-'subject_id')
    AND EXISTS(SELECT 1 FROM ops.deletion_jobs WHERE member_id=OLD.actor_id AND journaled_at IS NOT NULL)
   THEN RETURN NEW; END IF;
  END IF;
 END IF;
 RAISE EXCEPTION 'History is append only' USING ERRCODE='42501';
END $$;

DROP FUNCTION app.request_erasure(uuid,text);
DROP FUNCTION ops.erase_primary(uuid);
CREATE FUNCTION app.request_erasure(who uuid,receipt text,retention_months integer) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF length(receipt)<>64 OR NOT EXISTS(SELECT 1 FROM app.members WHERE id=who AND deletion_requested_at IS NOT NULL) THEN RAISE EXCEPTION 'Not an erasure request'; END IF;
 INSERT INTO ops.deletion_jobs(member_id,requested_at,receipt_hash,media_ids)
 SELECT who,deletion_requested_at,receipt,ARRAY(SELECT id FROM app.media WHERE member_id=who) FROM app.members WHERE id=who
 ON CONFLICT(member_id) DO UPDATE SET receipt_hash=coalesce(ops.deletion_jobs.receipt_hash,excluded.receipt_hash);
 PERFORM safety.remember_enforced_email(who,retention_months);
END $$;
REVOKE ALL ON FUNCTION app.request_erasure(uuid,text,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.request_erasure(uuid,text,integer) TO meetwell_app;

CREATE FUNCTION ops.erase_primary(who uuid, retention_months integer) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE o record; erased_encounters uuid[]; erased_opportunities uuid[]; email_key text;
BEGIN
 PERFORM pg_advisory_xact_lock(55,2);
 IF NOT EXISTS(SELECT 1 FROM ops.deletion_jobs WHERE member_id=who AND journaled_at IS NOT NULL) THEN RAISE EXCEPTION 'Durable tombstone required'; END IF;
 PERFORM safety.remember_enforced_email(who,retention_months);
 SELECT array_agg(id) INTO erased_opportunities FROM app.opportunities WHERE who IN(low_id,high_id);
 SELECT array_agg(id) INTO erased_encounters FROM app.encounters WHERE who IN(low_id,high_id);
 FOR o IN SELECT * FROM app.opportunities WHERE id=ANY(erased_opportunities) ORDER BY low_id,high_id LOOP
  PERFORM app.lock_pair(o.low_id,o.high_id);
  PERFORM app.close_opportunity(o.id,CASE WHEN o.state='MUTUAL' THEN 'CLOSED' ELSE 'CANCELLED' END);
  PERFORM ops.purge_connection(o.id);
 END LOOP;
 DELETE FROM learning.experience WHERE member_id=who OR encounter_id=ANY(erased_encounters);
 DELETE FROM learning.logistics WHERE who IN(low_id,high_id);
 DELETE FROM learning.introduction_decision WHERE member_id=who OR opportunity_id=ANY(erased_opportunities);
 DELETE FROM learning.introduction_exposure WHERE who IN(low_id,high_id);
 DELETE FROM app.matching_feedback WHERE member_id=who OR encounter_id=ANY(erased_encounters);
 DELETE FROM app.feedback_prompts WHERE member_id=who OR encounter_id=ANY(erased_encounters);
 DELETE FROM app.encounters WHERE id=ANY(erased_encounters);
 DELETE FROM app.second_meeting_reports WHERE member_id=who OR connection_id=ANY(erased_opportunities);
 DELETE FROM app.outcome_followups WHERE member_id=who;
 DELETE FROM app.success_exits WHERE member_id=who;
 DELETE FROM app.attention_minutes WHERE member_id=who;
 DELETE FROM app.attention_consent WHERE member_id=who;
 DELETE FROM app.introduction_mail WHERE member_id=who OR opportunity_id=ANY(erased_opportunities);
 DELETE FROM app.introduction_outbox WHERE opportunity_id=ANY(erased_opportunities);
 DELETE FROM app.introduction_decisions WHERE member_id=who OR opportunity_id=ANY(erased_opportunities);
 DELETE FROM app.opportunity_closures WHERE opportunity_id=ANY(erased_opportunities);
 DELETE FROM app.connections WHERE id=ANY(erased_opportunities);
 DELETE FROM app.opportunities WHERE id=ANY(erased_opportunities);
 DELETE FROM app.profile_access WHERE viewer_id=who OR subject_id=who;
 -- Encrypted feasible sets and summaries can include non-selected members.
 -- Lifecycle code scrubs affected batches before invoking this function.
 IF EXISTS(SELECT 1 FROM app.explore_batches WHERE creator_id=who) THEN
  UPDATE app.explore_batches SET creator_id=NULL WHERE creator_id=who;
 END IF;
 -- Other members' receipts contain only their own policy/version or opaque
 -- result IDs, never partner profile/feedback/chat payloads. Preserve those
 -- retry keys so an unrelated deletion cannot duplicate a chat or transition.
 DELETE FROM app.command_receipts WHERE member_id=who;
 DELETE FROM ops.moderation_receipts WHERE actor_id=who OR result->>'id' IN
  (SELECT id::text FROM app.media WHERE member_id=who);
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
 DELETE FROM identity.rate_limits WHERE bucket IN('write:'||who,'connections:'||who,
  'lifecycle:'||who,'explore:'||who,'safety-submit:'||who,'email:'||email_key);
 -- Keep unrelated and global abuse budgets; one erasure must not reset them.
 DELETE FROM ops.staff WHERE member_id=who;
 DELETE FROM ops.readiness_reviews WHERE actor_id=who;
 -- Preserve the staff action and timestamp, unlink its optional subject.
 UPDATE ops.audit SET subject_id=NULL WHERE actor_id=who AND subject_id IS NOT NULL;
 DELETE FROM ops.audit WHERE actor_id<>who AND (subject_id=who OR subject_id=ANY(erased_opportunities)
  OR subject_id IN(SELECT unnest(media_ids) FROM ops.deletion_jobs WHERE member_id=who));
 DELETE FROM ops.metric_members WHERE member_id=who;
 DELETE FROM ops.metric_snapshots; -- recompute from remaining rows; fixed cohort denominators are immutable
 DELETE FROM safety.command_receipts WHERE actor_id=who;
 -- D9 case payloads stay only in the safety boundary, reviewed and time bounded.
 UPDATE ops.deletion_jobs SET completed_at=clock_timestamp() WHERE member_id=who;
 INSERT INTO ops.lifecycle_audit(event) VALUES('ERASED');
END $$;
REVOKE ALL ON FUNCTION ops.erase_primary(uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ops.erase_primary(uuid,integer) TO meetwell_worker;
