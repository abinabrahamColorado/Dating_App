-- M5, Spec P13/P17/P22/P26, I-10/I-12/I-19/I-20.
-- No location, narratives, chat or demographics cross into learning.
CREATE TABLE app.encounters (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), plan_id uuid NOT NULL,
 revision integer NOT NULL, connection_id uuid NOT NULL, low_id uuid NOT NULL, high_id uuid NOT NULL,
 start_at timestamptz NOT NULL, timezone text NOT NULL, eligible boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), UNIQUE(plan_id,revision)
);
CREATE TABLE app.feedback_prompts (
 encounter_id uuid NOT NULL REFERENCES app.encounters(id), member_id uuid NOT NULL,
 due_at timestamptz NOT NULL, presented_at timestamptz, dismissed_at timestamptz,
 PRIMARY KEY(encounter_id,member_id)
);
CREATE TABLE app.matching_feedback (
 encounter_id uuid NOT NULL REFERENCES app.encounters(id), member_id uuid NOT NULL,
 body_cipher text NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(encounter_id,member_id)
);
CREATE TABLE app.second_meeting_reports (
 connection_id uuid NOT NULL, member_id uuid NOT NULL,
 met_again boolean NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(connection_id,member_id)
);
CREATE TABLE app.success_exits (
 member_id uuid PRIMARY KEY, meaningful boolean NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE app.outcome_followups (
 member_id uuid NOT NULL REFERENCES app.success_exits(member_id), day integer NOT NULL CHECK(day IN(30,90)),
 consented_at timestamptz NOT NULL DEFAULT clock_timestamp(), due_at timestamptz NOT NULL,
 revoked_at timestamptz, presented_at timestamptz,
 answer text CHECK(answer IN('CONTINUING','ENDED','PREFER_NOT_TO_SAY')),
 answered_at timestamptz, PRIMARY KEY(member_id,day)
);
CREATE TABLE app.attention_consent (
 member_id uuid PRIMARY KEY, enabled boolean NOT NULL DEFAULT false,
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE app.attention_minutes (
 member_id uuid NOT NULL, minute timestamptz NOT NULL, seconds integer NOT NULL CHECK(seconds BETWEEN 1 AND 60),
 PRIMARY KEY(member_id,minute)
);
GRANT SELECT,INSERT,UPDATE ON app.encounters,app.feedback_prompts,app.outcome_followups,app.attention_consent TO meetwell_app;
GRANT SELECT,INSERT ON app.matching_feedback,app.second_meeting_reports,app.success_exits,app.attention_minutes TO meetwell_app;
CREATE TRIGGER immutable_matching_feedback BEFORE UPDATE OR DELETE ON app.matching_feedback FOR EACH ROW EXECUTE FUNCTION ops.reject_history_mutation();
CREATE TRIGGER immutable_second_meetings BEFORE UPDATE OR DELETE ON app.second_meeting_reports FOR EACH ROW EXECUTE FUNCTION ops.reject_history_mutation();

CREATE TABLE learning.experience (
 encounter_id uuid NOT NULL, member_id uuid NOT NULL,
 event text NOT NULL CHECK(event IN('PROMPT','ANSWERED')),
 met text CHECK(met IN('YES','NO','PREFER_NOT_TO_SAY')),
 again text CHECK(again IN('YES','NOT_SURE','NO','SKIP')),
 chips text[] NOT NULL DEFAULT '{}', observed_at timestamptz NOT NULL,
 PRIMARY KEY(encounter_id,member_id,event), CHECK(cardinality(chips)<=2),
 CHECK((event='PROMPT' AND met IS NULL AND again IS NULL AND cardinality(chips)=0) OR (event='ANSWERED' AND met IS NOT NULL)),
 CHECK(chips <@ ARRAY['Easy conversation','Felt attraction','Shared outlook','No spark','Different goals','Different lifestyle'])
);
CREATE TABLE learning.logistics (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), encounter_id uuid NOT NULL,
 low_id uuid NOT NULL, high_id uuid NOT NULL,
 event text NOT NULL CHECK(event IN('CONFIRMED','CANCELLED','ATTENDANCE')),
 provenance text NOT NULL CHECK(provenance IN('BOTH_REPORTED','ONE_REPORTED','HOST_CONFIRMED_FOR_EVENT','DISPUTED','UNKNOWN')),
 attended boolean, occurred_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TRIGGER immutable_experience BEFORE UPDATE OR DELETE ON learning.experience FOR EACH ROW EXECUTE FUNCTION ops.reject_history_mutation();
CREATE TRIGGER immutable_logistics BEFORE UPDATE OR DELETE ON learning.logistics FOR EACH ROW EXECUTE FUNCTION ops.reject_history_mutation();
GRANT SELECT ON learning.experience,learning.logistics TO meetwell_learning;

CREATE FUNCTION app.capture_encounter() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v app.plan_versions%ROWTYPE; o app.opportunities%ROWTYPE; encounter uuid;
BEGIN
 IF NEW.state='CONFIRMED' THEN
  SELECT * INTO v FROM app.plan_versions WHERE plan_id=NEW.id AND revision=NEW.revision;
  SELECT * INTO o FROM app.opportunities WHERE id=NEW.connection_id;
  INSERT INTO app.encounters(plan_id,revision,connection_id,low_id,high_id,start_at,timezone)
   VALUES(NEW.id,NEW.revision,NEW.connection_id,o.low_id,o.high_id,v.start_at,v.venue_snapshot->>'timezone')
   ON CONFLICT DO NOTHING RETURNING id INTO encounter;
  IF encounter IS NOT NULL THEN
   INSERT INTO learning.logistics(encounter_id,low_id,high_id,event,provenance)
    VALUES(encounter,o.low_id,o.high_id,'CONFIRMED','UNKNOWN');
  END IF;
 END IF;
 -- A cancellation before the meeting removes the prompt, never labels a no-show.
 -- A closure after the planned start preserves optional private feedback.
 IF NEW.state<>'CONFIRMED' OR NEW.revision<>OLD.revision THEN
  FOR encounter IN UPDATE app.encounters SET eligible=false WHERE plan_id=NEW.id
   AND (revision<>NEW.revision OR NEW.state<>'CONFIRMED') AND eligible AND start_at>clock_timestamp()
   RETURNING id LOOP
   INSERT INTO learning.logistics(encounter_id,low_id,high_id,event,provenance)
    SELECT id,low_id,high_id,'CANCELLED','UNKNOWN' FROM app.encounters WHERE id=encounter;
  END LOOP;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER capture_encounter AFTER UPDATE ON app.plans FOR EACH ROW EXECUTE FUNCTION app.capture_encounter();
-- Preserve existing synthetic confirmed plans without manufacturing attendance.
INSERT INTO app.encounters(plan_id,revision,connection_id,low_id,high_id,start_at,timezone)
 SELECT p.id,p.revision,p.connection_id,o.low_id,o.high_id,v.start_at,v.venue_snapshot->>'timezone'
 FROM app.plans p JOIN app.opportunities o ON o.id=p.connection_id
 JOIN app.plan_versions v ON v.plan_id=p.id AND v.revision=p.revision WHERE p.state='CONFIRMED';
INSERT INTO learning.logistics(encounter_id,low_id,high_id,event,provenance)
 SELECT id,low_id,high_id,'CONFIRMED','UNKNOWN' FROM app.encounters;

-- App callers cannot insert arbitrary columns into learning, or read another answer.
CREATE FUNCTION app.record_experience(encounter uuid, actor uuid, met_value text, again_value text, chip_values text[], attendance_value text, attended_value boolean) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE e app.encounters%ROWTYPE;
BEGIN
 SELECT * INTO e FROM app.encounters WHERE id=encounter AND actor IN(low_id,high_id);
 IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM app.matching_feedback WHERE encounter_id=encounter AND member_id=actor) THEN RAISE EXCEPTION 'Unavailable'; END IF;
 INSERT INTO learning.experience(encounter_id,member_id,event,met,again,chips,observed_at)
  VALUES(encounter,actor,'ANSWERED',met_value,again_value,chip_values,clock_timestamp()) ON CONFLICT DO NOTHING;
 INSERT INTO learning.logistics(encounter_id,low_id,high_id,event,provenance,attended)
  VALUES(encounter,e.low_id,e.high_id,'ATTENDANCE',attendance_value,attended_value);
END $$;
REVOKE ALL ON FUNCTION app.record_experience(uuid,uuid,text,text,text[],text,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.record_experience(uuid,uuid,text,text,text[],text,boolean) TO meetwell_app;

CREATE FUNCTION app.record_feedback_prompt(encounter uuid,actor uuid,due timestamptz) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM app.encounters WHERE id=encounter AND actor IN(low_id,high_id) AND eligible) THEN RETURN; END IF;
 INSERT INTO app.feedback_prompts(encounter_id,member_id,due_at) VALUES(encounter,actor,due) ON CONFLICT DO NOTHING;
 INSERT INTO learning.experience(encounter_id,member_id,event,observed_at)
  VALUES(encounter,actor,'PROMPT',clock_timestamp()) ON CONFLICT DO NOTHING;
END $$;
REVOKE ALL ON FUNCTION app.record_feedback_prompt(uuid,uuid,timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.record_feedback_prompt(uuid,uuid,timestamptz) TO meetwell_app;

CREATE TABLE ops.metric_cohorts (
 id uuid PRIMARY KEY, started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 denominator integer NOT NULL CHECK(denominator>=0), policy_version text NOT NULL,
 thresholds jsonb NOT NULL
);
CREATE TABLE ops.metric_members (
 cohort_id uuid NOT NULL REFERENCES ops.metric_cohorts(id), member_id uuid NOT NULL UNIQUE,
 PRIMARY KEY(cohort_id,member_id)
);
CREATE TABLE ops.metric_snapshots (
 cohort_id uuid PRIMARY KEY REFERENCES ops.metric_cohorts(id), body jsonb NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
GRANT SELECT ON ops.metric_cohorts,ops.metric_snapshots TO meetwell_ops;
CREATE TRIGGER immutable_metric_cohort BEFORE UPDATE OR DELETE ON ops.metric_cohorts FOR EACH ROW EXECUTE FUNCTION ops.reject_history_mutation();
CREATE TRIGGER immutable_metric_members BEFORE UPDATE OR DELETE ON ops.metric_members FOR EACH ROW EXECUTE FUNCTION ops.reject_history_mutation();
ALTER TABLE ops.audit DROP CONSTRAINT audit_action_check;
ALTER TABLE ops.audit ADD CHECK(action IN('QUEUE_READ','MEDIA_READ','MEDIA_APPROVED','MEDIA_REJECTED','AUDIT_READ','STAFF_GRANTED','STAFF_REVOKED','EXPLORE_REVIEW','EXPLORE_GENERATED','EXPLORE_EDITED','EXPLORE_APPROVED','VENUE_READ','VENUE_REVIEWED','METRICS_READ','COHORT_FROZEN','PRIVACY_REVIEW'));
CREATE FUNCTION ops.freeze_metric_cohort(cohort uuid,actor uuid,policy text,settings jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ids uuid[];
BEGIN
 PERFORM pg_advisory_xact_lock(55,1);
 IF EXISTS(SELECT 1 FROM ops.metric_cohorts WHERE id=cohort) THEN RETURN; END IF;
 SELECT coalesce(array_agg(m.id ORDER BY m.id),'{}'::uuid[]) INTO ids FROM app.members m
  WHERE state='ACTIVE' AND intent='EXPLORE' AND deletion_requested_at IS NULL
   AND NOT app.enforcement_status(m.id) AND NOT EXISTS(SELECT 1 FROM ops.metric_members WHERE member_id=m.id);
 INSERT INTO ops.metric_cohorts(id,denominator,policy_version,thresholds) VALUES(cohort,cardinality(ids),policy,settings);
 INSERT INTO ops.metric_members SELECT cohort,unnest(ids);
END $$;
REVOKE ALL ON FUNCTION ops.freeze_metric_cohort(uuid,uuid,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ops.freeze_metric_cohort(uuid,uuid,text,jsonb) TO meetwell_ops;
GRANT USAGE ON SCHEMA ops TO meetwell_worker;
GRANT SELECT ON ops.metric_cohorts,ops.metric_members TO meetwell_worker;
GRANT SELECT,INSERT,UPDATE ON ops.metric_snapshots TO meetwell_worker;
