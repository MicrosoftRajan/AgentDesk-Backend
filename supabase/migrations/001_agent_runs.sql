-- Reconstructed baseline for agent_runs.
--
-- The original 001 file was not in this repository. This statement matches
-- the columns the API reads and writes. `create table if not exists` does
-- not alter a table that is already there, and it does not delete rows.
-- Enabling row level security does not remove data. The API uses the
-- service role, which bypasses RLS. With no policies, the anon key cannot
-- read this table.

create table if not exists agent_runs (
  id uuid primary key default gen_random_uuid(),

  goal text not null,

  status text not null default 'pending' check (
    status in (
      'pending',
      'running',
      'awaiting_approval',
      'completed',
      'failed',
      'cancelled'
    )
  ),

  response text,

  created_at timestamptz not null default now(),
  completed_at timestamptz
);

alter table agent_runs enable row level security;
