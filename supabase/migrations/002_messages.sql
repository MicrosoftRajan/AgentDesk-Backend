-- Phase 9: conversation messages for each agent run.

create table if not exists messages (
  id uuid primary key default gen_random_uuid(),

  run_id uuid not null
    references agent_runs(id)
    on delete cascade,

  role text not null check (
    role in ('user', 'assistant', 'tool', 'system')
  ),

  content text not null,

  created_at timestamptz not null default now()
);

create index if not exists messages_run_id_created_at_idx
on messages(run_id, created_at);

-- Memory retrieval reads recent completed runs.
create index if not exists agent_runs_status_created_at_idx
on agent_runs(status, created_at desc);

-- The API uses the service role key (bypasses RLS). Enabling RLS with no
-- policies keeps this table unreachable with the public anon key.
alter table messages enable row level security;
