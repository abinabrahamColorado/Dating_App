-- Spec P22/I-19: SELECT FOR UPDATE requires an UPDATE privilege in PostgreSQL.
-- Grant a bounded lock operation, not permission for the app role to approve photos.
CREATE FUNCTION app.lock_member_media(owner_id uuid)
RETURNS TABLE(id uuid, status text, version integer)
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT m.id,m.status,m.version FROM app.media m WHERE m.member_id=owner_id ORDER BY m.id FOR UPDATE;
$$;
REVOKE ALL ON FUNCTION app.lock_member_media(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.lock_member_media(uuid) TO meetwell_app;
