-- Spec P22; DEC-030. Additive, no payload rewrite or external delivery.
ALTER TABLE identity.magic_links
  ADD COLUMN next_attempt_at timestamptz NOT NULL DEFAULT now();
CREATE INDEX magic_links_delivery_due
  ON identity.magic_links(next_attempt_at, created_at, id)
  WHERE sent_at IS NULL AND consumed_at IS NULL;
