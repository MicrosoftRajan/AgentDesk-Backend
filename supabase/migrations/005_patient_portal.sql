-- Phase 12: patient portal.
--
-- 1. profiles: one row per auth user, holding their ROLE ('staff' or
--    'patient') plus the contact details a patient books with.
-- 2. appointments.patient_user_id: links an appointment to the patient
--    account that booked it (null = booked by front-desk staff / agent).
--
-- Roles are only ever written by this migration or by an admin in the SQL
-- editor. The API never lets a client set its own role.

create table if not exists profiles (
  id uuid primary key
    references auth.users(id)
    on delete cascade,

  role text not null default 'patient' check (
    role in ('staff', 'patient')
  ),

  full_name text,
  phone text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Everyone who already has an account today is clinic staff (the app
-- only had a staff side until now). New sign-ups default to 'patient'.
insert into profiles (id, role)
select id, 'staff'
from auth.users
on conflict (id) do nothing;

-- Patient-facing lookups: "my appointments".
alter table appointments
  add column if not exists patient_user_id uuid
    references auth.users(id)
    on delete set null;

create index if not exists appointments_patient_user_id_scheduled_at_idx
on appointments(patient_user_id, scheduled_at desc)
where patient_user_id is not null;

-- The API uses the service role key (bypasses RLS). Enabling RLS with no
-- policies keeps this table unreachable with the public anon key, so a
-- client cannot promote itself to staff.
alter table profiles enable row level security;

-- Make the API pick up the new table/column immediately instead of
-- failing with "Could not find the table ... in the schema cache".
notify pgrst, 'reload schema';

-- To make someone clinic staff later:
--   update profiles set role = 'staff' where id = '<auth user id>';
