-- Spike database setup. Run as a non-superuser owner: FORCE RLS applies to the owner too.
DROP TABLE IF EXISTS client, client_norls, tenant;
CREATE TABLE tenant (id uuid PRIMARY KEY, name text NOT NULL);
CREATE TABLE client (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  name text NOT NULL,
  email text NOT NULL,
  UNIQUE (tenant_id, id)
);
CREATE INDEX client_tenant_name ON client (tenant_id, name);
CREATE TABLE client_norls (LIKE client INCLUDING ALL);

ALTER TABLE client ENABLE ROW LEVEL SECURITY;
ALTER TABLE client FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON client
  USING      (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

-- 50 tenants x 2,000 clients = 100,000 rows per table.
INSERT INTO tenant SELECT uuidv7(), 'Tenant ' || g FROM generate_series(1, 50) g;
INSERT INTO client_norls
  SELECT uuidv7(), t.id, 'Client ' || g, 'c' || g || '@example.test'
  FROM tenant t, generate_series(1, 2000) g;
-- FORCE RLS applies to the owner too, so seed each tenant with the setting in place.
DO $$
DECLARE t uuid;
BEGIN
  FOR t IN SELECT id FROM tenant LOOP
    PERFORM set_config('app.tenant_id', t::text, true);
    INSERT INTO client SELECT * FROM client_norls WHERE tenant_id = t;
  END LOOP;
END $$;
ANALYZE;
