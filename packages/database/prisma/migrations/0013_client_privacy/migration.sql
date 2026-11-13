-- Data-subject export and erasure (RA 10173). ADR-032. Additive: no data is changed here
-- except granting the new `clients.privacy` permission to existing Owner roles.

-- AlterTable
ALTER TABLE "client" ADD COLUMN "erased_at" TIMESTAMPTZ(3);

-- ---------------------------------------------------------------------------
-- Measurement erasure: the only way to delete measurements (ADR-027 stays in force
-- everywhere else). Rows may be deleted only by erase_client_measurements(), which runs as
-- the table owner and marks the client being erased for the duration of its own work.
-- The app role can set the marker itself, but it is never the table owner, so it still
-- cannot update or delete measurements.
-- ---------------------------------------------------------------------------
CREATE FUNCTION forbid_measurement_mutation() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  erasing uuid := nullif(current_setting('app.erasing_client', true), '')::uuid;
  owner name := (SELECT tableowner FROM pg_tables
                 WHERE schemaname = TG_TABLE_SCHEMA AND tablename = TG_TABLE_NAME);
  record_client uuid;
BEGIN
  IF TG_OP = 'DELETE' AND erasing IS NOT NULL AND current_user = owner THEN
    IF TG_TABLE_NAME = 'measurement_record' THEN
      record_client := OLD.client_id;
    ELSE
      SELECT r.client_id INTO record_client FROM measurement_record r
        WHERE r.tenant_id = OLD.tenant_id AND r.id = OLD.record_id;
    END IF;
    IF record_client = erasing THEN
      RETURN OLD;
    END IF;
  END IF;
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = 'insufficient_privilege';
END $$;

DROP TRIGGER measurement_record_immutable ON "measurement_record";
DROP TRIGGER measurement_value_immutable ON "measurement_value";
CREATE TRIGGER measurement_record_immutable BEFORE UPDATE OR DELETE ON "measurement_record"
  FOR EACH ROW EXECUTE FUNCTION forbid_measurement_mutation();
CREATE TRIGGER measurement_value_immutable BEFORE UPDATE OR DELETE ON "measurement_value"
  FOR EACH ROW EXECUTE FUNCTION forbid_measurement_mutation();
-- TRUNCATE stays forbidden (measurement_*_no_truncate, migration 0008).

-- Deletes every measurement of one client in the current tenant (RLS is forced, so the
-- owner sees only app.tenant_id's rows). Revisions point at older ones with ON DELETE
-- RESTRICT, so newest revisions go first. Returns the number of records deleted.
CREATE FUNCTION erase_client_measurements(p_client_id uuid) RETURNS integer
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
DECLARE
  total integer := 0;
  n integer;
BEGIN
  IF app_tenant_id() IS NULL THEN
    RAISE EXCEPTION 'erase_client_measurements needs a tenant context';
  END IF;
  PERFORM set_config('app.erasing_client', p_client_id::text, true);
  DELETE FROM measurement_value v USING measurement_record r
    WHERE v.tenant_id = r.tenant_id AND v.record_id = r.id AND r.client_id = p_client_id;
  LOOP
    DELETE FROM measurement_record r
      WHERE r.client_id = p_client_id
        AND NOT EXISTS (SELECT 1 FROM measurement_record x
                        WHERE x.tenant_id = r.tenant_id AND x.supersedes_id = r.id);
    GET DIAGNOSTICS n = ROW_COUNT;
    EXIT WHEN n = 0;
    total := total + n;
  END LOOP;
  PERFORM set_config('app.erasing_client', '', true);
  IF EXISTS (SELECT 1 FROM measurement_record WHERE client_id = p_client_id) THEN
    RAISE EXCEPTION 'measurements of client % are still referenced', p_client_id;
  END IF;
  RETURN total;
END $$;

REVOKE ALL ON FUNCTION erase_client_measurements(uuid) FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'tahi_app') THEN
    GRANT EXECUTE ON FUNCTION erase_client_measurements(uuid) TO tahi_app;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- New permission for existing ateliers: Owner roles get `clients.privacy` (new ateliers
-- get it from SYSTEM_ROLES at onboarding). RLS is forced, so go tenant by tenant.
-- ---------------------------------------------------------------------------
DO $$
DECLARE t uuid;
BEGIN
  FOR t IN SELECT id FROM tenant LOOP
    PERFORM set_config('app.tenant_id', t::text, true);
    INSERT INTO role_permission (tenant_id, role_id, permission)
      SELECT r.tenant_id, r.id, 'clients.privacy' FROM role r
      WHERE r.key = 'owner' AND r.is_system
      ON CONFLICT DO NOTHING;
  END LOOP;
  PERFORM set_config('app.tenant_id', '', true);
END $$;
