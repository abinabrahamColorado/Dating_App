-- Spec P4/P5/P11/P12/P22. M1 data is encrypted before reaching PostgreSQL.
CREATE TABLE identity.users (
  id uuid PRIMARY KEY,
  email_lookup text NOT NULL UNIQUE,
  email_cipher text NOT NULL,
  birth_cipher text,
  registered_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE identity.consents (
  id uuid PRIMARY KEY,
  member_id uuid NOT NULL REFERENCES identity.users(id),
  purpose text NOT NULL CHECK (purpose IN ('terms','privacy')),
  document_version text NOT NULL,
  granted_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(member_id, purpose, document_version)
);
CREATE TABLE identity.magic_links (
  id uuid PRIMARY KEY,
  email_lookup text NOT NULL,
  payload_cipher text NOT NULL,
  token_hash text NOT NULL UNIQUE,
  browser_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  sent_at timestamptz,
  attempts integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON identity.magic_links (email_lookup, created_at);
CREATE TABLE identity.sessions (
  id uuid PRIMARY KEY,
  member_id uuid NOT NULL REFERENCES identity.users(id),
  token_hash text NOT NULL UNIQUE,
  authenticated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz
);
CREATE INDEX ON identity.sessions(member_id);
CREATE TABLE identity.passkeys (
  credential_id text PRIMARY KEY,
  member_id uuid NOT NULL REFERENCES identity.users(id),
  public_key bytea NOT NULL,
  counter bigint NOT NULL,
  transports jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE identity.challenges (
  id uuid PRIMARY KEY,
  member_id uuid REFERENCES identity.users(id),
  session_id uuid REFERENCES identity.sessions(id),
  challenge text NOT NULL,
  purpose text NOT NULL CHECK(purpose IN ('register','authenticate')),
  browser_hash text NOT NULL,
  expires_at timestamptz NOT NULL
);
CREATE TABLE identity.rate_limits (
  bucket text PRIMARY KEY,
  window_start timestamptz NOT NULL,
  requests integer NOT NULL CHECK(requests > 0)
);
GRANT SELECT, INSERT, UPDATE ON identity.users, identity.magic_links, identity.sessions,
  identity.passkeys, identity.rate_limits TO meetwell_identity;
GRANT SELECT, INSERT ON identity.consents TO meetwell_identity;
GRANT SELECT, INSERT, DELETE ON identity.challenges TO meetwell_identity;

-- Account policy lives in app; identity owns credentials/DOB, never a second mutable state.
CREATE TABLE app.members (
  id uuid PRIMARY KEY,
  state text NOT NULL DEFAULT 'ONBOARDING' CHECK(state IN ('ONBOARDING','ACTIVE','PAUSED','EXITED','RESTRICTED')),
  intent text NOT NULL DEFAULT 'EXPLORE' CHECK(intent IN ('EXPLORE','FOCUS')),
  nearby text NOT NULL DEFAULT 'GHOST' CHECK(nearby = 'GHOST'),
  version integer NOT NULL DEFAULT 0,
  epoch integer NOT NULL DEFAULT 0,
  pause_chat boolean NOT NULL DEFAULT false,
  plan_reminders boolean NOT NULL DEFAULT false,
  deletion_requested_at timestamptz,
  exit_reason text CHECK(exit_reason IN ('met-someone-here','taking-a-break','other')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE app.profiles (
  member_id uuid PRIMARY KEY REFERENCES app.members(id),
  body_cipher text NOT NULL,
  version integer NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE app.preference_versions (
  member_id uuid NOT NULL REFERENCES app.members(id),
  version integer NOT NULL,
  prior_version integer NOT NULL,
  source text NOT NULL DEFAULT 'USER' CHECK(source = 'USER'),
  scope text NOT NULL DEFAULT 'FUTURE_INTRODUCTIONS' CHECK(scope = 'FUTURE_INTRODUCTIONS'),
  body_cipher text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(member_id, version),
  CHECK(version = prior_version + 1)
);
CREATE TABLE app.media (
  id uuid PRIMARY KEY,
  member_id uuid NOT NULL REFERENCES app.members(id),
  status text NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','APPROVED','REJECTED','REMOVED')),
  version integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON app.media(member_id, status);
CREATE INDEX ON app.media(status, created_at);
CREATE TABLE app.command_receipts (
  member_id uuid NOT NULL REFERENCES app.members(id),
  command_key uuid NOT NULL,
  request_hash text NOT NULL,
  result_cipher text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(member_id, command_key)
);
GRANT SELECT, INSERT, UPDATE ON app.members, app.profiles TO meetwell_app;
GRANT SELECT, INSERT ON app.media TO meetwell_app;
CREATE FUNCTION app.remove_media(photo uuid, owner_id uuid) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog AS $$
  UPDATE app.media SET status = 'REMOVED', version = version + 1
  WHERE id = photo AND member_id = owner_id;
$$;
REVOKE ALL ON FUNCTION app.remove_media(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.remove_media(uuid, uuid) TO meetwell_app;
GRANT SELECT, INSERT ON app.preference_versions, app.command_receipts TO meetwell_app;

CREATE TABLE ops.staff (
  member_id uuid NOT NULL,
  role text NOT NULL CHECK(role IN ('operator','safety_reviewer','admin')),
  PRIMARY KEY(member_id, role)
);
CREATE TABLE ops.audit (
  id uuid PRIMARY KEY,
  actor_id uuid NOT NULL,
  action text NOT NULL CHECK(action IN ('QUEUE_READ','MEDIA_READ','MEDIA_APPROVED','MEDIA_REJECTED','AUDIT_READ','STAFF_GRANTED')),
  subject_id uuid,
  request_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON ops.audit(created_at);
CREATE TABLE ops.moderation_receipts (
  actor_id uuid NOT NULL, command_key uuid NOT NULL, request_hash text NOT NULL,
  result jsonb NOT NULL, PRIMARY KEY(actor_id, command_key)
);
GRANT SELECT ON ops.staff TO meetwell_ops;
GRANT SELECT, INSERT ON ops.audit, ops.moderation_receipts TO meetwell_ops;
GRANT USAGE ON SCHEMA app TO meetwell_ops;
GRANT SELECT ON app.media TO meetwell_ops;
GRANT UPDATE(status, version) ON app.media TO meetwell_ops;

-- Runtime cannot rewrite consent, preference or audit history.
CREATE FUNCTION ops.reject_history_mutation() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN RAISE EXCEPTION 'History is append only' USING ERRCODE = '42501'; END $$;
CREATE TRIGGER immutable_preferences BEFORE UPDATE OR DELETE ON app.preference_versions
FOR EACH ROW EXECUTE FUNCTION ops.reject_history_mutation();
CREATE TRIGGER immutable_consents BEFORE UPDATE OR DELETE ON identity.consents
FOR EACH ROW EXECUTE FUNCTION ops.reject_history_mutation();
CREATE TRIGGER immutable_audit BEFORE UPDATE OR DELETE ON ops.audit
FOR EACH ROW EXECUTE FUNCTION ops.reject_history_mutation();
