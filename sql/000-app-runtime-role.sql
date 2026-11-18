-- =============================================================================
-- 000-app-runtime-role.sql — restricted runtime role for the AgentDesk API
-- =============================================================================
--
-- WHAT THIS DOES
--   Creates the `agentdesk_app` login role that the Express
--   server and `npm run db:check` connect as. The `postgres` role is used only
--   to run this script and, later, migrations. It never goes in backend/.env.
--
-- HOW TO RUN (manual, once; nothing runs this automatically)
--   1. Read the whole script.
--   2. Supabase Dashboard -> SQL Editor -> paste this file -> Run.
--      It runs as `postgres` and is safe to run again.
--   3. Set the password separately. See "SETTING THE PASSWORD" below.
--      This script never contains or sets a real password.
--   4. Check the result with the read-only query in section D.
--
-- WHAT IT CHANGES
--   A. Creates a role ................. CREATE ROLE (if missing). An existing role is checked for
--                                       attributes, memberships it holds, and objects it owns. It is never altered.
--   B. Role settings .................. ALTER ROLE ... SET (search_path, timeouts)
--   C. Grants privileges .............. GRANT CONNECT (database), GRANT USAGE (schema public)
--   D. Read-only check ................ SELECT only
--
-- WHAT IT DOES NOT DO
--   - No table, sequence, function, or default privileges. Each table feature
--     grants exactly what it needs.
--   - No membership in any role (postgres, authenticator, anon, authenticated,
--     service_role, supabase_admin, pg_* roles, ...).
--   - No CREATE on any schema.
--   - No password. The role cannot log in until the password is set.
--
-- SETTING THE PASSWORD (pick one; never commit it, never paste it into chat)
--   Recommended: psql's \password, which hashes the password on your machine
--   (SCRAM) so plain text never reaches the server, its logs, or the
--   SQL Editor history:
--       psql "<postgres connection string from the Supabase dashboard>"
--       \password agentdesk_app
--
--   Alternative: Supabase SQL Editor. Run this one line on its own, with a
--   long random password in place of the marker, then delete that query
--   from the editor so it is not kept in saved snippets or history:
--       ALTER ROLE agentdesk_app WITH PASSWORD '<<REPLACE_WITH_GENERATED_PASSWORD>>';
--
--   Generate a password with, for example:  openssl rand -base64 32
--   Then put it, URL-encoded, in backend/.env:
--       DATABASE_URL=postgresql://agentdesk_app.<project-ref>:<url-encoded-password>@aws-0-<region>.pooler.supabase.com:5432/postgres
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- A. CREATES THE ROLE (or checks an existing one)
--    New role: created with no password (NULL), so it cannot authenticate yet.
--    Existing role: checked, never altered. Supabase's `postgres` is not a
--      superuser, and PostgreSQL refuses to let a non-superuser name
--      SUPERUSER/REPLICATION/BYPASSRLS in ALTER ROLE, even to turn them off.
--      Any of these aborts the script, and the transaction rolls back:
--        1. Unsafe attributes (superuser, createdb, createrole, replication,
--           bypassrls, inherit, or cannot log in).
--        2. Memberships HELD BY agentdesk_app (pg_auth_members.member =
--           agentdesk_app): being a member of another role lets it use that
--           role's privileges. Rows where another role is a member OF
--           agentdesk_app (roleid = agentdesk_app) are NOT counted. On
--           PostgreSQL 16+ the creating role (Supabase's `postgres`) gets such
--           a membership automatically. That gives agentdesk_app nothing.
--        3. Ownership of any object, in any database (pg_shdepend owner
--           entries: tables, schemas, functions, types, databases, ...). An
--           owner can alter, drop, and grant on its objects and bypasses RLS on
--           its own tables unless RLS is forced. Ownership is never transferred
--           or dropped automatically.
--      The password is never touched. Error messages give counts, not names.
-- -----------------------------------------------------------------------------
do $$
declare
  r pg_catalog.pg_roles%rowtype;
  memberships_held bigint;
  owned_objects bigint;
begin
  select * into r from pg_catalog.pg_roles where rolname = 'agentdesk_app';

  if not found then
    create role agentdesk_app
      login
      password null
      nosuperuser
      nocreatedb
      nocreaterole
      noreplication
      nobypassrls
      noinherit;
    return;
  end if;

  if r.rolsuper or r.rolcreatedb or r.rolcreaterole or r.rolreplication
     or r.rolbypassrls or r.rolinherit or not r.rolcanlogin then
    raise exception 'agentdesk_app already exists with unsafe attributes; fix it manually before running this script';
  end if;

  select count(*) into memberships_held
  from pg_catalog.pg_auth_members m
  where m.member = r.oid;

  if memberships_held > 0 then
    raise exception 'agentdesk_app is a member of % other role(s); revoke those memberships manually before running this script', memberships_held;
  end if;

  select count(*) into owned_objects
  from pg_catalog.pg_shdepend d
  where d.refclassid = 'pg_catalog.pg_authid'::pg_catalog.regclass
    and d.refobjid = r.oid
    and d.deptype = 'o';

  if owned_objects > 0 then
    raise exception 'agentdesk_app owns % database object(s); reassign ownership manually (for example REASSIGN OWNED) before running this script', owned_objects;
  end if;
end
$$;

-- -----------------------------------------------------------------------------
-- B. ROLE SETTINGS (applied to every new session of agentdesk_app)
--    These three statements run on EVERY execution, including when the role
--    already exists. They overwrite any drifted value (for example a
--    statement_timeout someone set to 0) with the values below. Sessions
--    already open keep their old values until they reconnect.
--    search_path: only `public`. pg_catalog is always searched first. "$user" is
--      left out, so a schema named after the role cannot shadow objects.
--    statement_timeout: a runaway query is cancelled after 15 s.
--    idle_in_transaction_session_timeout: a transaction left open (holding
--      locks) is ended after 30 s.
-- -----------------------------------------------------------------------------
alter role agentdesk_app set search_path = public;
alter role agentdesk_app set statement_timeout = '15s';
alter role agentdesk_app set idle_in_transaction_session_timeout = '30s';

-- -----------------------------------------------------------------------------
-- C. GRANTS PRIVILEGES (the minimum for the current connection check)
--    CONNECT on the `postgres` database: open a session.
--    USAGE on schema `public`: resolve names in the schema that later holds the
--      app tables. This gives no access to any table and no right to create.
-- -----------------------------------------------------------------------------
grant connect on database postgres to agentdesk_app;
grant usage on schema public to agentdesk_app;

commit;

-- -----------------------------------------------------------------------------
-- D. READ-ONLY CHECK (expected values in comments)
-- -----------------------------------------------------------------------------
select
  r.rolname,
  r.rolcanlogin,                                       -- true
  r.rolsuper,                                          -- false
  r.rolcreatedb,                                       -- false
  r.rolcreaterole,                                     -- false
  r.rolreplication,                                    -- false
  r.rolbypassrls,                                      -- false
  r.rolinherit,                                        -- false
  r.rolconfig,                                         -- {search_path=public,statement_timeout=15s,idle_in_transaction_session_timeout=30s}
  (select count(*) from pg_catalog.pg_auth_members m
     where m.member = r.oid)          as member_of_roles, -- 0
  (select count(*) from pg_catalog.pg_shdepend d
     where d.refclassid = 'pg_catalog.pg_authid'::pg_catalog.regclass
       and d.refobjid = r.oid and d.deptype = 'o') as owned_objects, -- 0
  has_database_privilege(r.oid, 'postgres', 'CONNECT') as can_connect,        -- true
  has_schema_privilege(r.oid, 'public', 'USAGE')       as public_usage,       -- true
  has_schema_privilege(r.oid, 'public', 'CREATE')      as public_create       -- false
from pg_catalog.pg_roles r
where r.rolname = 'agentdesk_app';
