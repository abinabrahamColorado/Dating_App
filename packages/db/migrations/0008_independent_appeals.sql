-- Spec P20/P21: the appeal reviewer must differ from the challenged decision maker.
-- Nullable for earlier synthetic M2 fixtures only; unknown provenance fails closed.
ALTER TABLE safety.enforcement ADD COLUMN issued_by uuid;
ALTER TABLE safety.appeal ADD COLUMN challenged_actor uuid;
