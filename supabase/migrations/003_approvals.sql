-- Phase 10: guardrails + human approval.

-- 1. New run status: awaiting_approval.
--    Drops whichever CHECK constraint currently guards agent_runs.status
--    (its name isn't tracked in this repo) and recreates it.
do $$
declare
  c record;
begin
  for c in
    select conname
    from pg_constraint
    where conrelid = 'agent_runs'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%status%'
  loop
    execute format('alter table agent_runs drop constraint %I', c.conname);
  end loop;
end $$;

alter table agent_runs
  add constraint agent_runs_status_check check (
    status in (
      'pending',
      'running',
      'awaiting_approval',
      'completed',
      'failed',
      'cancelled'
    )
  );

-- 2. Approval requests.
create table if not exists approval_requests (
  id uuid primary key default gen_random_uuid(),

  run_id uuid not null
    references agent_runs(id)
    on delete cascade,

  -- Cohere's id for the tool call being approved.
  tool_call_id text not null,

  tool_name text not null,

  tool_input jsonb not null,

  risk_level text not null check (
    risk_level in ('low', 'medium', 'high')
  ),

  status text not null default 'pending' check (
    status in ('pending', 'approved', 'rejected', 'expired')
  ),

  -- Server-only engine state used to resume the run after approval.
  -- Never returned by the API.
  checkpoint jsonb not null,

  created_at timestamptz not null default now(),

  -- Approvals must not stay pending forever (10 minutes by default).
  expires_at timestamptz not null,

  resolved_at timestamptz
);

create index if not exists approval_requests_run_id_idx
on approval_requests(run_id);

create index if not exists approval_requests_status_idx
on approval_requests(status);

-- A run can only have one open approval at a time.
create unique index if not exists approval_requests_one_pending_per_run_idx
on approval_requests(run_id)
where status = 'pending';

-- The API uses the service role key (bypasses RLS). Enabling RLS with no
-- policies keeps this table (and its checkpoints) unreachable with the anon key.
alter table approval_requests enable row level security;
