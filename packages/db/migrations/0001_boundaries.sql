-- Spec P22, I-12, I-19, I-20: schemas and non-login privilege roles only.
-- Run with a migration administrator on a dedicated application database.
CREATE EXTENSION IF NOT EXISTS postgis;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
DO $$
DECLARE role_name text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['meetwell_identity','meetwell_app','meetwell_safety','meetwell_learning','meetwell_ops','meetwell_worker'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format('CREATE ROLE %I NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS', role_name);
    END IF;
  END LOOP;
END $$;
-- A migration principal owns schemas; runtime groups never own application schemas.
CREATE SCHEMA identity;
CREATE SCHEMA app;
CREATE SCHEMA safety;
CREATE SCHEMA learning;
CREATE SCHEMA ops;
CREATE SCHEMA queue;
REVOKE ALL ON SCHEMA identity, app, safety, learning, ops, queue FROM PUBLIC;
GRANT USAGE ON SCHEMA identity TO meetwell_identity;
GRANT USAGE ON SCHEMA app TO meetwell_app;
GRANT USAGE ON SCHEMA safety TO meetwell_safety;
GRANT USAGE ON SCHEMA learning TO meetwell_learning;
GRANT USAGE ON SCHEMA ops TO meetwell_ops;
-- pg-boss owns only its isolated queue infrastructure, never business or case schemas.
GRANT USAGE, CREATE ON SCHEMA queue TO meetwell_worker;
CREATE TABLE ops.schema_migrations (
  name text PRIMARY KEY,
  checksum text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON ALL TABLES IN SCHEMA ops FROM PUBLIC;
GRANT SELECT ON ops.schema_migrations TO meetwell_ops;
-- Future migrations grant exact table/column permissions; no broad default grants.
ALTER DEFAULT PRIVILEGES IN SCHEMA identity, app, safety, learning, ops REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA identity, app, safety, learning, ops REVOKE ALL ON SEQUENCES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA identity, app, safety, learning, ops REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
