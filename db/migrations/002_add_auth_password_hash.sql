BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM app_user) THEN
    RAISE EXCEPTION 'Cannot add required password_hash when users already exist';
  END IF;
END;
$$;

ALTER TABLE app_user
ADD COLUMN password_hash TEXT NOT NULL;

COMMIT;
