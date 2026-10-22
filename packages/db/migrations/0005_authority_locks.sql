-- Spec P21/P22, I-19/I-20. Hold staff rows until the protected operation completes.
-- No runtime UPDATE privilege on role assignments is necessary to take these locks.
CREATE FUNCTION ops.lock_staff(actor uuid) RETURNS TABLE(role text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  PERFORM id FROM app.members WHERE id=actor AND deletion_requested_at IS NULL
    AND state NOT IN ('EXITED','RESTRICTED') FOR SHARE;
  IF NOT FOUND THEN RETURN; END IF;
  RETURN QUERY SELECT s.role FROM ops.staff s WHERE s.member_id=actor FOR SHARE;
END $$;
REVOKE ALL ON FUNCTION ops.lock_staff(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ops.lock_staff(uuid) TO meetwell_ops;
