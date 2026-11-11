-- Phase 1 baseline: extensions required by the planned schema.
-- All three are "trusted" extensions (PG 13+), so the migration role only needs
-- CREATE privilege on the database, not superuser.
CREATE EXTENSION IF NOT EXISTS citext;      -- case-insensitive emails
CREATE EXTENSION IF NOT EXISTS btree_gist;  -- appointment exclusion constraints
CREATE EXTENSION IF NOT EXISTS pg_trgm;     -- client search
