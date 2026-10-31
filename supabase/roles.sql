-- Local development and CI only. Passwords here are not secrets and must never be used on a
-- hosted project; docs/development.md lists the hosted steps.
create role tahi_migrator login password 'local_only_migrator' createdb;
create role tahi_api login password 'local_only_api' bypassrls;
grant tahi_migrator to postgres;
alter schema public owner to tahi_migrator;
-- Prisma checks for its schema on deploy, which requires CREATE on the database.
grant create on database postgres to tahi_migrator;
