-- Spec P6/P18/P22, I-04/I-09/I-12/I-20. No member coordinates or plaintext chat.
ALTER TABLE app.explore_venues ADD COLUMN version integer NOT NULL DEFAULT 0;
ALTER TABLE app.explore_venues ADD COLUMN details jsonb;
GRANT SELECT,INSERT,UPDATE ON app.explore_venues TO meetwell_ops;
CREATE TABLE ops.venue_private (
 venue_id uuid PRIMARY KEY REFERENCES app.explore_venues(id), body_cipher text NOT NULL
);
GRANT SELECT,INSERT,UPDATE ON ops.venue_private TO meetwell_ops;
CREATE TABLE ops.venue_receipts (
 actor_id uuid NOT NULL, command_key uuid NOT NULL, request_hash text NOT NULL,
 result jsonb NOT NULL, PRIMARY KEY(actor_id,command_key)
);
GRANT SELECT,INSERT ON ops.venue_receipts TO meetwell_ops;
ALTER TABLE ops.audit DROP CONSTRAINT audit_action_check;
ALTER TABLE ops.audit ADD CHECK(action IN ('QUEUE_READ','MEDIA_READ','MEDIA_APPROVED','MEDIA_REJECTED','AUDIT_READ','STAFF_GRANTED','STAFF_REVOKED','EXPLORE_REVIEW','EXPLORE_GENERATED','EXPLORE_EDITED','EXPLORE_APPROVED','VENUE_READ','VENUE_REVIEWED'));

CREATE TABLE app.messages (
 id uuid PRIMARY KEY, connection_id uuid NOT NULL REFERENCES app.connections(id),
 sender_id uuid NOT NULL, body_cipher text NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 state text NOT NULL DEFAULT 'PENDING' CHECK(state IN ('PENDING','DELIVERED','CANCELLED')),
 version integer NOT NULL DEFAULT 0
);
CREATE INDEX messages_connection ON app.messages(connection_id,created_at,id);
CREATE INDEX messages_pending ON app.messages(created_at,id) WHERE state='PENDING';
CREATE TABLE app.planning_preferences (
 connection_id uuid NOT NULL REFERENCES app.connections(id), member_id uuid NOT NULL,
 version integer NOT NULL DEFAULT 0, body_cipher text NOT NULL,
 PRIMARY KEY(connection_id,member_id)
);
CREATE TABLE app.plan_options (
 id uuid PRIMARY KEY, connection_id uuid NOT NULL REFERENCES app.connections(id),
 fingerprint text NOT NULL, body_cipher text NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(connection_id,fingerprint)
);
CREATE TABLE app.plans (
 id uuid PRIMARY KEY, connection_id uuid NOT NULL REFERENCES app.connections(id),
 version integer NOT NULL DEFAULT 0, revision integer NOT NULL DEFAULT 1,
 state text NOT NULL DEFAULT 'PROPOSED' CHECK(state IN ('PROPOSED','CONFIRMED','DECLINED','CANCELLED','INVALIDATED')),
 first_confirmed_at timestamptz, updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX plans_connection ON app.plans(connection_id,created_at,id);
CREATE TABLE app.plan_versions (
 plan_id uuid NOT NULL REFERENCES app.plans(id), revision integer NOT NULL,
 venue_id uuid NOT NULL REFERENCES app.explore_venues(id), venue_version integer NOT NULL,
 start_at timestamptz NOT NULL, minutes integer NOT NULL CHECK(minutes>0),
 venue_snapshot jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(plan_id,revision)
);
CREATE INDEX plan_versions_venue ON app.plan_versions(venue_id,plan_id,revision);
CREATE TABLE app.plan_confirmations (
 plan_id uuid NOT NULL, revision integer NOT NULL, member_id uuid NOT NULL,
 confirmed_at timestamptz NOT NULL DEFAULT clock_timestamp(), PRIMARY KEY(plan_id,revision,member_id),
 FOREIGN KEY(plan_id,revision) REFERENCES app.plan_versions(plan_id,revision)
);
CREATE TRIGGER immutable_plan_versions BEFORE UPDATE OR DELETE ON app.plan_versions FOR EACH ROW EXECUTE FUNCTION ops.reject_history_mutation();
CREATE TRIGGER immutable_plan_confirmations BEFORE UPDATE OR DELETE ON app.plan_confirmations FOR EACH ROW EXECUTE FUNCTION ops.reject_history_mutation();
GRANT SELECT,INSERT,UPDATE ON app.messages,app.planning_preferences,app.plans TO meetwell_app;
GRANT SELECT,INSERT ON app.plan_options,app.plan_versions,app.plan_confirmations TO meetwell_app;

CREATE FUNCTION app.venue_disabled(venue uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT EXISTS(SELECT 1 FROM safety.kill_switch WHERE scope='VENUE' AND target=venue::text AND disabled);
$$;
REVOKE ALL ON FUNCTION app.venue_disabled(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.venue_disabled(uuid) TO meetwell_app,meetwell_ops;

-- Catalog writers hold exclusive advisory (40,1); readers hold shared (40,1).
-- Revocation deliberately takes no member locks: catalog -> plan order cannot
-- cycle with member -> catalog -> plan confirmations or member-only closure.
CREATE FUNCTION app.invalidate_venue_plans(venue uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE item record;
BEGIN
 FOR item IN SELECT p.id FROM app.plans p JOIN app.plan_versions v ON v.plan_id=p.id AND v.revision=p.revision
 WHERE v.venue_id=venue AND p.state IN ('PROPOSED','CONFIRMED') AND v.start_at+v.minutes*interval '1 minute'>clock_timestamp()
 ORDER BY p.id FOR UPDATE OF p LOOP
  UPDATE app.plans SET state='INVALIDATED',version=version+1,updated_at=clock_timestamp() WHERE id=item.id;
 END LOOP;
END
$$;
REVOKE ALL ON FUNCTION app.invalidate_venue_plans(uuid) FROM PUBLIC;
CREATE FUNCTION app.venue_changed() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN PERFORM app.invalidate_venue_plans(NEW.id); RETURN NEW; END $$;
CREATE TRIGGER venue_plans AFTER UPDATE ON app.explore_venues FOR EACH ROW WHEN (OLD IS DISTINCT FROM NEW) EXECUTE FUNCTION app.venue_changed();
CREATE FUNCTION safety.venue_switch_changed() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF NEW.scope='VENUE' AND NEW.disabled THEN PERFORM app.invalidate_venue_plans(NEW.target::uuid); END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER venue_switch_plans AFTER INSERT OR UPDATE ON safety.kill_switch FOR EACH ROW EXECUTE FUNCTION safety.venue_switch_changed();
CREATE FUNCTION app.close_connection_content() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE item record;
BEGIN
 IF NEW.closed_at IS NOT NULL THEN
  UPDATE app.messages SET state='CANCELLED',version=version+1 WHERE connection_id=NEW.id AND state='PENDING';
  FOR item IN SELECT id FROM app.plans WHERE connection_id=NEW.id AND state IN ('PROPOSED','CONFIRMED') ORDER BY id FOR UPDATE LOOP
   UPDATE app.plans SET state='CANCELLED',version=version+1,updated_at=clock_timestamp() WHERE id=item.id;
  END LOOP;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER connection_content_closed AFTER UPDATE OF closed_at ON app.connections FOR EACH ROW EXECUTE FUNCTION app.close_connection_content();
