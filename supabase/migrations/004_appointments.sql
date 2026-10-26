-- Phase 11: clinic front-desk appointments.
--
-- Keep patient data minimal (name + phone only). Do NOT store clinical
-- details here until BAAs / DPDP consent / audit logging are in place.

create table if not exists appointments (
  id uuid primary key default gen_random_uuid(),

  patient_name text not null,
  patient_phone text not null,

  reason text,

  scheduled_at timestamptz not null,

  status text not null default 'scheduled' check (
    status in ('scheduled', 'cancelled', 'completed', 'no_show')
  ),

  cancel_reason text,
  last_reminder_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists appointments_scheduled_at_idx
on appointments(scheduled_at);

create index if not exists appointments_status_scheduled_at_idx
on appointments(status, scheduled_at);

-- Only one live appointment per time slot (single-doctor clinic for now).
create unique index if not exists appointments_active_slot_idx
on appointments(scheduled_at)
where status = 'scheduled';

-- The API uses the service role key (bypasses RLS). Enabling RLS with no
-- policies keeps this table unreachable with the public anon key.
alter table appointments enable row level security;
