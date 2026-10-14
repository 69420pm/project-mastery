-- The admin client (secret key, `service_role`) runs the background jobs: the
-- Material parse, the embeddings, the knowledge map build. It bypasses Row
-- Level Security but still needs table privileges, and a hosted Supabase
-- project no longer grants them to `service_role` on tables created through
-- SQL ("permission denied for table materials"). Local Supabase still does,
-- so only staging and production failed.

grant select, insert, update, delete on all tables in schema public
  to service_role;
grant usage, select on all sequences in schema public to service_role;

-- Tables and sequences that later migrations create get the same grants.
alter default privileges in schema public
  grant select, insert, update, delete on tables to service_role;
alter default privileges in schema public
  grant usage, select on sequences to service_role;
