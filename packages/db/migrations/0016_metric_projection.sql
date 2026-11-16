-- P26: bounded projections for the maintenance aggregator, never report text,
-- location, chat, DOB, demographics or current profile payloads.
CREATE FUNCTION ops.metric_input(cohort uuid,settings jsonb) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
 WITH c AS(SELECT * FROM ops.metric_cohorts WHERE id=cohort), m AS(SELECT member_id FROM ops.metric_members WHERE cohort_id=cohort),
 e AS(SELECT e.* FROM app.encounters e,c WHERE e.eligible AND e.start_at>=c.started_at AND e.start_at<c.started_at+(c.thresholds->>'OUTCOME_HORIZON_DAYS')::int*interval '1 day'
   AND EXISTS(SELECT 1 FROM m WHERE member_id IN(e.low_id,e.high_id)))
 SELECT jsonb_build_object(
 'members',coalesce((SELECT jsonb_agg(jsonb_build_object(
   'id',m.member_id,'state',a.state,'intent',a.intent,
   'offeredWithin14',EXISTS(SELECT 1 FROM learning.introduction_exposure x,c WHERE m.member_id IN(x.low_id,x.high_id) AND x.delivered_at>=c.started_at AND x.delivered_at<c.started_at+(c.thresholds->>'COVERAGE_HORIZON_DAYS')::int*interval '1 day'),
   'exposures',(SELECT count(*) FROM learning.introduction_exposure x,c WHERE m.member_id IN(x.low_id,x.high_id) AND x.delivered_at>=c.started_at AND x.delivered_at<least(clock_timestamp(),c.started_at+(c.thresholds->>'OUTCOME_HORIZON_DAYS')::int*interval '1 day')),
   'activeSeconds',CASE WHEN ac.enabled AND NOT EXISTS(SELECT 1 FROM c WHERE ac.updated_at>c.started_at OR c.started_at<clock_timestamp()-(settings->>'D13_MINIMIZED_COUNTER_DAYS')::int*interval '1 day') THEN (SELECT coalesce(sum(t.seconds),0) FROM app.attention_minutes t,c WHERE t.member_id=m.member_id AND t.minute>=c.started_at AND t.minute<least(clock_timestamp(),c.started_at+(c.thresholds->>'OUTCOME_HORIZON_DAYS')::int*interval '1 day')) ELSE NULL END
 )) FROM m JOIN app.members a ON a.id=m.member_id LEFT JOIN app.attention_consent ac ON ac.member_id=m.member_id),'[]'::jsonb),
 'meetings',coalesce((SELECT jsonb_agg(jsonb_build_object('id',e.id,'low',e.low_id,'high',e.high_id,'at',e.start_at,
  'a',CASE WHEN fa.member_id IS NOT NULL THEN jsonb_build_object('met',fa.met,'again',fa.again,'chips','[]'::jsonb) ELSE NULL END,
  'b',CASE WHEN fb.member_id IS NOT NULL THEN jsonb_build_object('met',fb.met,'again',fb.again,'chips','[]'::jsonb) ELSE NULL END))
  FROM e LEFT JOIN learning.experience fa ON fa.encounter_id=e.id AND fa.member_id=e.low_id AND fa.event='ANSWERED'
  LEFT JOIN learning.experience fb ON fb.encounter_id=e.id AND fb.member_id=e.high_id AND fb.event='ANSWERED'),'[]'::jsonb),
 'secondReports',coalesce((SELECT jsonb_agg(jsonb_build_object('low',o.low_id,'high',o.high_id,'a',a.met_again,'b',b.met_again,
  'both',coalesce(a.met_again AND b.met_again,false),'at',greatest(a.created_at,b.created_at)))
  FROM app.opportunities o LEFT JOIN app.second_meeting_reports a ON a.connection_id=o.id AND a.member_id=o.low_id
  LEFT JOIN app.second_meeting_reports b ON b.connection_id=o.id AND b.member_id=o.high_id
  WHERE (a.member_id IS NOT NULL OR b.member_id IS NOT NULL) AND EXISTS(SELECT 1 FROM m WHERE member_id IN(o.low_id,o.high_id))),'[]'::jsonb),
 'successes',(SELECT count(*) FROM app.success_exits s JOIN m ON m.member_id=s.member_id,c WHERE s.meaningful AND s.created_at>=c.started_at),
 'exitObserved',(SELECT count(*) FROM app.success_exits s JOIN m ON m.member_id=s.member_id,c WHERE s.created_at>=c.started_at),
 'followups',coalesce((SELECT jsonb_agg(to_jsonb(f)) FROM (
   SELECT day,count(*) consented,count(*) FILTER(WHERE answer='CONTINUING') continuing,
   count(*) FILTER(WHERE answer='ENDED') ended,count(*) FILTER(WHERE answer='PREFER_NOT_TO_SAY') abstained,
   count(*) FILTER(WHERE revoked_at IS NOT NULL) withdrawn,count(*) FILTER(WHERE due_at>clock_timestamp()) not_due
   FROM app.outcome_followups f JOIN m ON m.member_id=f.member_id GROUP BY day ORDER BY day) f),'[]'::jsonb),
 'batches',coalesce((SELECT jsonb_agg(jsonb_build_object('id',b.id,'summary_cipher',b.summary_cipher)) FROM app.explore_batches b,c
  WHERE b.created_at>=c.started_at AND b.created_at<c.started_at+(c.thresholds->>'COVERAGE_HORIZON_DAYS')::int*interval '1 day'),'[]'::jsonb)
 );
$$;
REVOKE ALL ON FUNCTION ops.metric_input(uuid,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ops.metric_input(uuid,jsonb) TO meetwell_worker;

CREATE FUNCTION ops.queue_counts(settings jsonb) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object(
 'reportsOpen',(SELECT count(*) FROM safety.report WHERE status<>'CLOSED'),
 'urgentOpen',(SELECT count(*) FROM safety.report WHERE status<>'CLOSED' AND severity='URGENT'),
 'urgentOldestHours',(SELECT extract(epoch FROM clock_timestamp()-min(created_at))/3600 FROM safety.report WHERE status<>'CLOSED' AND severity='URGENT'),
 'nonurgentOverdue',(SELECT count(*) FROM safety.report WHERE status='RECEIVED' AND severity<>'URGENT' AND created_at<clock_timestamp()-(settings->>'NONURGENT_ACK_HOURS')::int*interval '1 hour'),
 'integrityOpen',(SELECT count(*) FROM safety.integrity_signal WHERE status<>'CLOSED'),
 'appealsOpen',(SELECT count(*) FROM safety.appeal WHERE status='OPEN'),
 'appealsDecided',(SELECT count(*) FROM safety.appeal WHERE status<>'OPEN'),
 'appealsLifted',(SELECT count(*) FROM safety.appeal WHERE status='LIFTED'),
 'deletionsRequested',(SELECT count(*) FROM ops.deletion_jobs),
 'deletionsCompleted',(SELECT count(*) FROM ops.deletion_jobs WHERE completed_at IS NOT NULL),
 'deletionsOverdue',(SELECT count(*) FROM ops.deletion_jobs WHERE completed_at IS NULL AND requested_at<clock_timestamp()-(settings->>'DELETION_ACTIVE_STORES_DAYS')::int*interval '1 day'),
 'inactiveReviewsDue',coalesce((SELECT due_count FROM ops.privacy_reviews WHERE kind='INACTIVE'),0),
 'auditReviewsDue',coalesce((SELECT due_count FROM ops.privacy_reviews WHERE kind='AUDIT'),0),
 'safetyReviewsDue',coalesce((SELECT due_count FROM ops.privacy_reviews WHERE kind='SAFETY'),0),
 'photoQueue',(SELECT count(*) FROM app.media WHERE status='PENDING'),
 'mailUncertain',(SELECT count(*) FROM app.introduction_mail WHERE state IN('UNCERTAIN','FAILED'))
 );
$$;
REVOKE ALL ON FUNCTION ops.queue_counts(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ops.queue_counts(jsonb) TO meetwell_worker;
CREATE TABLE ops.readiness_reviews (
 gate text PRIMARY KEY CHECK(gate IN('CONSENT_PRIVACY','OPERATIONS','EXPERIENCE')),
 version integer NOT NULL, passed boolean NOT NULL, evidence_cipher text NOT NULL,
 actor_id uuid NOT NULL, command_key uuid NOT NULL, request_hash text NOT NULL,
 reviewed_at timestamptz NOT NULL DEFAULT clock_timestamp(),expires_at timestamptz NOT NULL
);
GRANT SELECT,INSERT,UPDATE ON ops.readiness_reviews TO meetwell_ops;
GRANT SELECT(gate,passed,expires_at) ON ops.readiness_reviews TO meetwell_worker;
