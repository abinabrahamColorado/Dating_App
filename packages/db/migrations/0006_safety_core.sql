-- Spec P17/P20/P21/P22: narratives never enter app, ops or learning.
CREATE TABLE app.blocks (
  low_id uuid NOT NULL, high_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(low_id,high_id), CHECK(low_id<high_id)
);
GRANT SELECT,INSERT ON app.blocks TO meetwell_app;
-- Disclosure authority, not a discovery feed. M3 will create grants with real introductions.
-- M2 has no runtime writer; synthetic test fixtures exercise the read boundary.
CREATE TABLE app.profile_access (
  viewer_id uuid NOT NULL, subject_id uuid NOT NULL,
  expires_at timestamptz NOT NULL, PRIMARY KEY(viewer_id,subject_id), CHECK(viewer_id<>subject_id)
);
GRANT SELECT ON app.profile_access TO meetwell_app;
CREATE TABLE safety.report (
  id uuid PRIMARY KEY, reporter_id uuid NOT NULL, subject_id uuid,
  detail_cipher text NOT NULL, context_cipher text NOT NULL,
  severity text NOT NULL CHECK(severity IN ('STANDARD','HIGH','URGENT')),
  status text NOT NULL DEFAULT 'RECEIVED' CHECK(status IN ('RECEIVED','IN_REVIEW','CLOSED')),
  version integer NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT now(), closed_at timestamptz
);
CREATE INDEX ON safety.report(status,severity,created_at,id);
CREATE INDEX ON safety.report(reporter_id,created_at);
CREATE TABLE safety.safety_signal (
  id uuid PRIMARY KEY, report_id uuid NOT NULL REFERENCES safety.report(id),
  kind text NOT NULL CHECK(kind='MEMBER_REPORT'), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE safety.integrity_signal (
  id uuid PRIMARY KEY, reporter_id uuid NOT NULL, subject_id uuid,
  detail_cipher text NOT NULL, context_cipher text NOT NULL,
  status text NOT NULL DEFAULT 'RECEIVED' CHECK(status IN ('RECEIVED','IN_REVIEW','CLOSED')),
  version integer NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE safety.enforcement (
  member_id uuid PRIMARY KEY, restricted boolean NOT NULL, version integer NOT NULL,
  case_id uuid REFERENCES safety.report(id), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE safety.appeal (
  id uuid PRIMARY KEY, member_id uuid NOT NULL, enforcement_version integer NOT NULL,
  detail_cipher text NOT NULL, status text NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN','UPHELD','LIFTED')),
  version integer NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(member_id,enforcement_version)
);
CREATE TABLE safety.case_access_audit (
  id uuid PRIMARY KEY, actor_id uuid NOT NULL, record_id uuid,
  action text NOT NULL, request_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER immutable_case_access BEFORE UPDATE OR DELETE ON safety.case_access_audit
FOR EACH ROW EXECUTE FUNCTION ops.reject_history_mutation();
CREATE TABLE safety.command_receipts (
  actor_id uuid NOT NULL, command_key uuid NOT NULL, request_hash text NOT NULL,
  result_cipher text NOT NULL, PRIMARY KEY(actor_id,command_key)
);
CREATE TABLE safety.kill_switch (
  scope text NOT NULL CHECK(scope IN ('VENUE','EVENT','ALL_GO','NEW_PERSON_GO')),
  target text NOT NULL, disabled boolean NOT NULL, version integer NOT NULL,
  PRIMARY KEY(scope,target), CHECK((scope IN ('ALL_GO','NEW_PERSON_GO') AND target='GLOBAL') OR
    (scope IN ('VENUE','EVENT') AND target<>'GLOBAL'))
);
GRANT SELECT,INSERT,UPDATE ON safety.report,safety.integrity_signal,safety.enforcement,safety.appeal,safety.kill_switch TO meetwell_safety;
GRANT SELECT,INSERT ON safety.safety_signal,safety.case_access_audit,safety.command_receipts TO meetwell_safety;

-- Only the minimum serving fact crosses the schema boundary; no case IDs or reporter data.
CREATE FUNCTION app.enforcement_status(subject uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT coalesce((SELECT restricted FROM safety.enforcement WHERE member_id=subject),false);
$$;
REVOKE ALL ON FUNCTION app.enforcement_status(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.enforcement_status(uuid) TO meetwell_app,meetwell_ops;
-- Lock helpers expose no data and allow row locks without granting arbitrary UPDATE.
CREATE FUNCTION app.lock_pair(u uuid,v uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 PERFORM id FROM app.members WHERE id IN(u,v) ORDER BY id FOR UPDATE;
END $$;
REVOKE ALL ON FUNCTION app.lock_pair(uuid,uuid) FROM PUBLIC;
GRANT USAGE ON SCHEMA app TO meetwell_safety;
GRANT EXECUTE ON FUNCTION app.lock_pair(uuid,uuid) TO meetwell_app,meetwell_safety;
