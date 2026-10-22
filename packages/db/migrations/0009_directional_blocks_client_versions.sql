-- Spec P20, I-04. Historic unordered rows have no recoverable initiator in SQL.
-- Preserve their denial without assigning an invented blocker. These holds have
-- no member removal grant; resolving provenance is a separately audited operation.
CREATE TABLE app.legacy_pair_denials (
  low_id uuid NOT NULL, high_id uuid NOT NULL, created_at timestamptz NOT NULL,
  PRIMARY KEY(low_id,high_id), CHECK(low_id<high_id)
);
INSERT INTO app.legacy_pair_denials SELECT low_id,high_id,created_at FROM app.blocks;
DELETE FROM app.blocks;
GRANT SELECT ON app.legacy_pair_denials TO meetwell_app;
ALTER TABLE app.blocks ADD COLUMN blocker_id uuid NOT NULL;
ALTER TABLE app.blocks DROP CONSTRAINT blocks_pkey;
ALTER TABLE app.blocks ADD PRIMARY KEY(blocker_id,low_id,high_id);
ALTER TABLE app.blocks ADD CHECK(blocker_id=low_id OR blocker_id=high_id);
CREATE INDEX blocks_pair_lookup ON app.blocks(low_id,high_id);
-- No runtime DELETE/UPDATE grant or unblock endpoint. Any later removal command
-- must authorize blocker_id against the authenticated actor, never just the pair.

ALTER TABLE safety.kill_switch DROP CONSTRAINT kill_switch_scope_check;
ALTER TABLE safety.kill_switch DROP CONSTRAINT kill_switch_check;
ALTER TABLE safety.kill_switch ADD CHECK(scope IN ('VENUE','EVENT','ALL_GO','NEW_PERSON_GO','CLIENT_VERSION'));
ALTER TABLE safety.kill_switch ADD CHECK(
  (scope IN ('ALL_GO','NEW_PERSON_GO') AND target='GLOBAL') OR
  (scope IN ('VENUE','EVENT','CLIENT_VERSION') AND target<>'GLOBAL')
);
CREATE FUNCTION app.client_version_disabled(client_version text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT coalesce((SELECT disabled FROM safety.kill_switch
   WHERE scope='CLIENT_VERSION' AND target=client_version),false);
$$;
REVOKE ALL ON FUNCTION app.client_version_disabled(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.client_version_disabled(text) TO meetwell_app;
