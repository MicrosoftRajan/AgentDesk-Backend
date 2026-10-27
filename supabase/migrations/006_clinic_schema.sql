-- Clinic schema from the approved ER diagram.
--
-- Apply after 001–005. This file does not touch agent_runs, messages,
-- or approval_requests. It replaces the single-clinic appointment row
-- (name, phone, one slot per start time) with organizations, locations,
-- patients, schedules, and the appointment rules in docs/DATA_MODEL.md.
--
-- Run the whole file once, in one transaction. A second run stops
-- because appointments.patient_id already exists.
--
-- Existing rows are kept:
--   scheduled  -> pending     (the old table had no doctor)
--   cancelled  -> canceled
--   no_show    -> incomplete
--   completed  -> incomplete  (completed now requires a doctor)
-- A completed row also gets an appointment_events note when a staff
-- profile exists to act as the actor.
--
-- The current reminder tool still writes appointments.last_reminder_at.
-- That column is not on the ER diagram. It stays so the tool keeps working.

create extension if not exists btree_gist;

do $$
begin
  if to_regclass('public.appointments') is null
     or to_regclass('public.profiles') is null then
    raise exception
      'Apply migrations 001 through 005 before 006_clinic_schema';
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'appointments'
      and column_name = 'patient_id'
  ) then
    raise exception '006_clinic_schema is already applied';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Triggers used by the new tables. search_path is empty so the bodies
-- cannot be redirected at a name in another schema.
-- ---------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.assert_location_timezone()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from pg_catalog.pg_timezone_names
    where name = new.timezone
  ) then
    raise exception 'unknown timezone %', new.timezone
      using errcode = '22023';
  end if;

  return new;
end;
$$;

create or replace function public.assert_department_in_location()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.department_id is not null
     and not exists (
       select 1
       from public.departments
       where id = new.department_id
         and location_id = new.location_id
     ) then
    raise exception 'department does not belong to this location'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

create or replace function public.assert_doctor_works_at_location()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.staff_assignments as assignment
    join public.profiles as profile
      on profile.id = assignment.user_id
    where assignment.user_id = new.doctor_id
      and assignment.location_id = new.location_id
      and profile.role = 'doctor'
  ) then
    raise exception 'doctor is not assigned to this location'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

create or replace function public.assert_assignment_not_in_use()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if exists (
    select 1
    from public.doctor_schedules
    where doctor_id = old.user_id
      and location_id = old.location_id
  ) or exists (
    select 1
    from public.schedule_exceptions
    where doctor_id = old.user_id
      and location_id = old.location_id
  ) then
    raise exception
      'remove this doctor''s hours at the location before unassigning them'
      using errcode = '23503';
  end if;

  return old;
end;
$$;

-- timestamptz + interval is STABLE in Postgres, so an exclusion constraint
-- cannot use it directly. A fixed number of minutes is deterministic.
-- The wrapper is immutable so the GiST index can call it.
create or replace function public.appointment_range(
  starts_at timestamptz,
  duration_minutes integer
)
returns tstzrange
language sql
immutable
set search_path = ''
as $$
  select tstzrange(
    starts_at,
    starts_at + (duration_minutes * interval '1 minute'),
    '[)'
  );
$$;

create or replace function public.reject_appointment_event_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'appointment_events is append-only'
    using errcode = '55000';
end;
$$;

-- Writes one history row when the visit is created or its status, doctor,
-- or time changes. Skips the row when no profile is available to be the
-- actor (the agent books without a user id today).
create or replace function public.record_appointment_event()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  actor uuid;
  kind text;
begin
  if tg_op = 'INSERT' then
    actor := new.created_by;

    if actor is not null then
      insert into public.appointment_events (
        appointment_id,
        actor_id,
        event_type,
        to_status,
        to_doctor_id,
        to_scheduled_at
      ) values (
        new.id,
        actor,
        'created',
        new.status,
        new.doctor_id,
        new.scheduled_at
      );
    end if;

    return new;
  end if;

  if new.status is not distinct from old.status
     and new.doctor_id is not distinct from old.doctor_id
     and new.scheduled_at is not distinct from old.scheduled_at then
    return new;
  end if;

  actor := coalesce(new.assigned_by, new.created_by);

  if new.scheduled_at is distinct from old.scheduled_at then
    kind := 'rescheduled';
  elsif new.status = 'canceled' and old.status is distinct from 'canceled' then
    kind := 'canceled';
  elsif old.doctor_id is null and new.doctor_id is not null then
    kind := 'assigned';
  else
    kind := 'status_changed';
  end if;

  if actor is not null then
    insert into public.appointment_events (
      appointment_id,
      actor_id,
      event_type,
      from_status,
      to_status,
      from_doctor_id,
      to_doctor_id,
      from_scheduled_at,
      to_scheduled_at
    ) values (
      new.id,
      actor,
      kind,
      old.status,
      new.status,
      old.doctor_id,
      new.doctor_id,
      old.scheduled_at,
      new.scheduled_at
    );
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Organization, people, and schedules.
-- ---------------------------------------------------------------------------

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint organizations_name_not_blank check (char_length(btrim(name)) > 0),
  constraint organizations_name_unique unique (name)
);

create table public.locations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  name text not null,
  timezone text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint locations_name_not_blank check (char_length(btrim(name)) > 0),
  constraint locations_organization_name_unique unique (organization_id, name)
);

create index locations_organization_id_idx
  on public.locations (organization_id);

create trigger locations_timezone
  before insert or update of timezone on public.locations
  for each row execute function public.assert_location_timezone();

create trigger locations_set_updated_at
  before update on public.locations
  for each row execute function public.set_updated_at();

create trigger organizations_set_updated_at
  before update on public.organizations
  for each row execute function public.set_updated_at();

create table public.departments (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.locations (id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint departments_name_not_blank check (char_length(btrim(name)) > 0),
  constraint departments_location_name_unique unique (location_id, name)
);

create trigger departments_set_updated_at
  before update on public.departments
  for each row execute function public.set_updated_at();

-- (id, location_id) lets other tables prove a department belongs to the
-- location they already store. id is unique, so this does not change identity.
alter table public.departments
  add constraint departments_id_location_unique unique (id, location_id);

do $$
declare
  role_check record;
begin
  for role_check in
    select conname
    from pg_constraint
    where conrelid = 'public.profiles'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%role%'
  loop
    execute format(
      'alter table public.profiles drop constraint %I',
      role_check.conname
    );
  end loop;
end $$;

alter table public.profiles
  add constraint profiles_role_check check (
    role in ('patient', 'staff', 'doctor', 'admin')
  );

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

create table public.staff_assignments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  location_id uuid not null references public.locations (id) on delete restrict,
  department_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint staff_assignments_user_location_unique unique (user_id, location_id),
  -- Null department_id skips this check. A set department must be that location.
  -- Deleting the department is refused while an assignment still names it.
  constraint staff_assignments_department_location_fkey
    foreign key (department_id, location_id)
    references public.departments (id, location_id)
);

create index staff_assignments_location_id_idx
  on public.staff_assignments (location_id);

create index staff_assignments_department_id_idx
  on public.staff_assignments (department_id)
  where department_id is not null;

create trigger staff_assignments_department
  before insert or update of department_id, location_id
  on public.staff_assignments
  for each row execute function public.assert_department_in_location();

create trigger staff_assignments_set_updated_at
  before update on public.staff_assignments
  for each row execute function public.set_updated_at();

create trigger staff_assignments_not_in_use
  before delete on public.staff_assignments
  for each row execute function public.assert_assignment_not_in_use();

create table public.patients (
  id uuid primary key default gen_random_uuid(),
  user_id uuid unique references public.profiles (id) on delete set null,
  full_name text not null,
  phone text not null,
  date_of_birth date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint patients_full_name_not_blank check (char_length(btrim(full_name)) > 0),
  constraint patients_phone_not_blank check (char_length(btrim(phone)) > 0)
);

create trigger patients_set_updated_at
  before update on public.patients
  for each row execute function public.set_updated_at();

create table public.appointment_types (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  name text not null,
  default_duration_minutes integer not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint appointment_types_name_not_blank check (char_length(btrim(name)) > 0),
  constraint appointment_types_duration_positive check (default_duration_minutes > 0),
  constraint appointment_types_organization_name_unique unique (organization_id, name)
);

create index appointment_types_organization_id_idx
  on public.appointment_types (organization_id);

create trigger appointment_types_set_updated_at
  before update on public.appointment_types
  for each row execute function public.set_updated_at();

create table public.schedule_templates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint schedule_templates_name_not_blank check (char_length(btrim(name)) > 0),
  constraint schedule_templates_organization_name_unique unique (organization_id, name)
);

create index schedule_templates_organization_id_idx
  on public.schedule_templates (organization_id);

create trigger schedule_templates_set_updated_at
  before update on public.schedule_templates
  for each row execute function public.set_updated_at();

create table public.template_shifts (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.schedule_templates (id) on delete cascade,
  weekday integer not null,
  start_time time not null,
  end_time time not null,
  slot_minutes integer not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint template_shifts_template_weekday_unique unique (template_id, weekday),
  constraint template_shifts_weekday_check check (weekday between 0 and 6),
  constraint template_shifts_time_order_check check (end_time > start_time),
  constraint template_shifts_slot_positive check (slot_minutes > 0)
);

create trigger template_shifts_set_updated_at
  before update on public.template_shifts
  for each row execute function public.set_updated_at();

create table public.doctor_schedules (
  id uuid primary key default gen_random_uuid(),
  doctor_id uuid not null references public.profiles (id) on delete cascade,
  location_id uuid not null references public.locations (id) on delete restrict,
  source_template_id uuid references public.schedule_templates (id) on delete set null,
  weekday integer not null,
  start_time time not null,
  end_time time not null,
  slot_minutes integer not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint doctor_schedules_doctor_location_weekday_unique
    unique (doctor_id, location_id, weekday),
  constraint doctor_schedules_weekday_check check (weekday between 0 and 6),
  constraint doctor_schedules_time_order_check check (end_time > start_time),
  constraint doctor_schedules_slot_positive check (slot_minutes > 0)
);

create index doctor_schedules_location_id_idx
  on public.doctor_schedules (location_id);

create index doctor_schedules_source_template_id_idx
  on public.doctor_schedules (source_template_id)
  where source_template_id is not null;

create trigger doctor_schedules_assigned
  before insert or update of doctor_id, location_id
  on public.doctor_schedules
  for each row execute function public.assert_doctor_works_at_location();

create trigger doctor_schedules_set_updated_at
  before update on public.doctor_schedules
  for each row execute function public.set_updated_at();

create table public.schedule_exceptions (
  id uuid primary key default gen_random_uuid(),
  doctor_id uuid not null references public.profiles (id) on delete cascade,
  location_id uuid not null references public.locations (id) on delete restrict,
  exception_date date not null,
  kind text not null,
  start_time time,
  end_time time,
  note text,
  created_by uuid not null references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint schedule_exceptions_doctor_location_date_unique
    unique (doctor_id, location_id, exception_date),
  constraint schedule_exceptions_kind_check check (
    kind in ('unavailable', 'modified_hours')
  ),
  constraint schedule_exceptions_hours_check check (
    (
      kind = 'unavailable'
      and start_time is null
      and end_time is null
    )
    or (
      kind = 'modified_hours'
      and start_time is not null
      and end_time is not null
      and end_time > start_time
    )
  )
);

create index schedule_exceptions_location_id_idx
  on public.schedule_exceptions (location_id);

create index schedule_exceptions_created_by_idx
  on public.schedule_exceptions (created_by);

create trigger schedule_exceptions_assigned
  before insert or update of doctor_id, location_id
  on public.schedule_exceptions
  for each row execute function public.assert_doctor_works_at_location();

create trigger schedule_exceptions_set_updated_at
  before update on public.schedule_exceptions
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Starting clinic. The running app is one branch in Asia/Kolkata,
-- 10:00–18:00, Sunday closed, 30-minute visits. Later branches are more rows.
-- ---------------------------------------------------------------------------

insert into public.organizations (name)
select 'AgentDesk'
where not exists (
  select 1 from public.organizations where name = 'AgentDesk'
);

insert into public.locations (organization_id, name, timezone)
select organization.id, 'Main', 'Asia/Kolkata'
from public.organizations as organization
where organization.name = 'AgentDesk'
  and not exists (
    select 1
    from public.locations as location
    where location.organization_id = organization.id
      and location.name = 'Main'
  );

insert into public.appointment_types (
  organization_id,
  name,
  default_duration_minutes,
  active
)
select organization.id, 'Consultation', 30, true
from public.organizations as organization
where organization.name = 'AgentDesk'
  and not exists (
    select 1
    from public.appointment_types as appointment_type
    where appointment_type.organization_id = organization.id
      and appointment_type.name = 'Consultation'
  );

insert into public.schedule_templates (organization_id, name)
select organization.id, 'Clinic week'
from public.organizations as organization
where organization.name = 'AgentDesk'
  and not exists (
    select 1
    from public.schedule_templates as template
    where template.organization_id = organization.id
      and template.name = 'Clinic week'
  );

insert into public.template_shifts (
  template_id,
  weekday,
  start_time,
  end_time,
  slot_minutes
)
select template.id, day.weekday, time '10:00', time '18:00', 30
from public.schedule_templates as template
cross join (
  values (1), (2), (3), (4), (5), (6)
) as day (weekday)
where template.name = 'Clinic week'
  and template.organization_id = (
    select id from public.organizations where name = 'AgentDesk'
  )
  and not exists (
    select 1
    from public.template_shifts as shift
    where shift.template_id = template.id
      and shift.weekday = day.weekday
  );

-- ---------------------------------------------------------------------------
-- Appointments: add the new columns, move old rows, then enforce the rules.
-- ---------------------------------------------------------------------------

alter table public.appointments
  add column patient_id uuid,
  add column location_id uuid,
  add column department_id uuid,
  add column appointment_type_id uuid,
  add column doctor_id uuid,
  add column duration_minutes integer,
  add column created_by uuid,
  add column assigned_by uuid;

create table public.appointment_events (
  id uuid primary key default gen_random_uuid(),
  appointment_id uuid not null references public.appointments (id) on delete restrict,
  actor_id uuid not null references public.profiles (id) on delete restrict,
  event_type text not null,
  from_status text,
  to_status text,
  from_doctor_id uuid,
  to_doctor_id uuid,
  from_scheduled_at timestamptz,
  to_scheduled_at timestamptz,
  note text,
  created_at timestamptz not null default now(),
  constraint appointment_events_type_check check (
    event_type in (
      'created',
      'assigned',
      'status_changed',
      'rescheduled',
      'canceled'
    )
  )
);

create index appointment_events_appointment_id_created_at_idx
  on public.appointment_events (appointment_id, created_at);

create index appointment_events_actor_id_idx
  on public.appointment_events (actor_id);

create trigger appointment_events_no_update
  before update on public.appointment_events
  for each row execute function public.reject_appointment_event_change();

create trigger appointment_events_no_delete
  before delete on public.appointment_events
  for each row execute function public.reject_appointment_event_change();

do $$
declare
  status_check record;
begin
  for status_check in
    select conname
    from pg_constraint
    where conrelid = 'public.appointments'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%status%'
  loop
    execute format(
      'alter table public.appointments drop constraint %I',
      status_check.conname
    );
  end loop;
end $$;

insert into public.profiles (id, role)
select distinct appointments.patient_user_id, 'patient'
from public.appointments as appointments
where appointments.patient_user_id is not null
on conflict (id) do nothing;

insert into public.appointment_events (
  appointment_id,
  actor_id,
  event_type,
  from_status,
  to_status,
  note
)
select
  appointments.id,
  actor.id,
  'status_changed',
  'completed',
  'incomplete',
  'Closed during the clinic schema migration. The previous table had no doctor, and completed requires one.'
from public.appointments as appointments
cross join lateral (
  select profiles.id
  from public.profiles as profiles
  where profiles.role in ('staff', 'admin', 'doctor')
  order by profiles.created_at
  limit 1
) as actor
where appointments.status = 'completed';

do $$
begin
  if exists (
    select 1 from public.appointments where status = 'completed'
  ) and not exists (
    select 1 from public.appointment_events where from_status = 'completed'
  ) then
    raise exception
      'completed appointments exist, but no staff profile can record the migration event';
  end if;
end $$;

update public.appointments
set status = 'pending'
where status = 'scheduled';

update public.appointments
set
  status = 'canceled',
  cancel_reason = coalesce(nullif(btrim(cancel_reason), ''), 'Canceled')
where status = 'cancelled';

update public.appointments
set status = 'incomplete'
where status in ('no_show', 'completed');

insert into public.patients (user_id, full_name, phone)
select distinct on (appointments.patient_user_id)
  appointments.patient_user_id,
  appointments.patient_name,
  appointments.patient_phone
from public.appointments as appointments
where appointments.patient_user_id is not null
order by appointments.patient_user_id, appointments.created_at desc;

insert into public.patients (full_name, phone)
select distinct appointments.patient_name, appointments.patient_phone
from public.appointments as appointments
where appointments.patient_user_id is null;

update public.appointments as appointments
set patient_id = patients.id
from public.patients as patients
where appointments.patient_user_id is not null
  and patients.user_id = appointments.patient_user_id;

update public.appointments as appointments
set patient_id = patients.id
from public.patients as patients
where appointments.patient_id is null
  and appointments.patient_user_id is null
  and patients.user_id is null
  and patients.full_name = appointments.patient_name
  and patients.phone = appointments.patient_phone;

update public.appointments
set
  location_id = (
    select locations.id
    from public.locations as locations
    join public.organizations as organizations
      on organizations.id = locations.organization_id
    where organizations.name = 'AgentDesk'
      and locations.name = 'Main'
  ),
  appointment_type_id = (
    select appointment_types.id
    from public.appointment_types as appointment_types
    join public.organizations as organizations
      on organizations.id = appointment_types.organization_id
    where organizations.name = 'AgentDesk'
      and appointment_types.name = 'Consultation'
  ),
  duration_minutes = 30
where patient_name is not null;

do $$
begin
  if exists (
    select 1
    from public.appointments
    where patient_id is null
       or location_id is null
       or appointment_type_id is null
       or duration_minutes is null
  ) then
    raise exception 'appointment backfill left a required column empty';
  end if;
end $$;

alter table public.appointments
  alter column patient_id set not null,
  alter column location_id set not null,
  alter column appointment_type_id set not null,
  alter column duration_minutes set not null,
  alter column status set default 'pending';

alter table public.appointments
  add constraint appointments_patient_id_fkey
    foreign key (patient_id) references public.patients (id) on delete restrict,
  add constraint appointments_location_id_fkey
    foreign key (location_id) references public.locations (id) on delete restrict,
  add constraint appointments_department_location_fkey
    foreign key (department_id, location_id)
    references public.departments (id, location_id),
  add constraint appointments_appointment_type_id_fkey
    foreign key (appointment_type_id)
    references public.appointment_types (id) on delete restrict,
  add constraint appointments_doctor_id_fkey
    foreign key (doctor_id) references public.profiles (id) on delete restrict,
  add constraint appointments_created_by_fkey
    foreign key (created_by) references public.profiles (id) on delete set null,
  add constraint appointments_assigned_by_fkey
    foreign key (assigned_by) references public.profiles (id) on delete set null,
  add constraint appointments_duration_positive check (duration_minutes > 0),
  add constraint appointments_status_check check (
    status in (
      'pending',
      'scheduled',
      'in_progress',
      'completed',
      'canceled',
      'incomplete'
    )
  ),
  add constraint appointments_doctor_status_check check (
    (status = 'pending' and doctor_id is null)
    or (
      status in ('scheduled', 'in_progress', 'completed')
      and doctor_id is not null
    )
    or status in ('canceled', 'incomplete')
  ),
  add constraint appointments_cancel_reason_check check (
    status <> 'canceled' or cancel_reason is not null
  );

-- A doctor who is scheduled or in progress cannot overlap another visit.
-- Pending rows have no doctor, so they are outside this constraint.
alter table public.appointments
  add constraint appointments_doctor_no_overlap
  exclude using gist (
    doctor_id with =,
    public.appointment_range(scheduled_at, duration_minutes) with &&
  )
  where (status in ('scheduled', 'in_progress'));

create trigger appointments_department
  before insert or update of department_id, location_id
  on public.appointments
  for each row execute function public.assert_department_in_location();

create trigger appointments_set_updated_at
  before update on public.appointments
  for each row execute function public.set_updated_at();

create trigger appointments_record_event
  after insert or update of status, doctor_id, scheduled_at, created_by, assigned_by
  on public.appointments
  for each row execute function public.record_appointment_event();

drop index if exists public.appointments_active_slot_idx;
drop index if exists public.appointments_scheduled_at_idx;
drop index if exists public.appointments_status_scheduled_at_idx;
drop index if exists public.appointments_patient_user_id_scheduled_at_idx;

alter table public.appointments
  drop column patient_name,
  drop column patient_phone,
  drop column patient_user_id;

create index appointments_location_scheduled_at_idx
  on public.appointments (location_id, scheduled_at);

create index appointments_patient_scheduled_at_idx
  on public.appointments (patient_id, scheduled_at desc);

create index appointments_doctor_scheduled_at_idx
  on public.appointments (doctor_id, scheduled_at)
  where doctor_id is not null;

create index appointments_department_id_idx
  on public.appointments (department_id)
  where department_id is not null;

create index appointments_appointment_type_id_idx
  on public.appointments (appointment_type_id);

create index appointments_created_by_idx
  on public.appointments (created_by)
  where created_by is not null;

create index appointments_assigned_by_idx
  on public.appointments (assigned_by)
  where assigned_by is not null;

create index appointments_status_scheduled_at_idx
  on public.appointments (status, scheduled_at);

-- ---------------------------------------------------------------------------
-- Row level security. No policies: the anon key cannot read these tables.
-- The API uses the service role, which bypasses RLS.
-- ---------------------------------------------------------------------------

alter table public.organizations enable row level security;
alter table public.locations enable row level security;
alter table public.departments enable row level security;
alter table public.staff_assignments enable row level security;
alter table public.patients enable row level security;
alter table public.appointment_types enable row level security;
alter table public.schedule_templates enable row level security;
alter table public.template_shifts enable row level security;
alter table public.doctor_schedules enable row level security;
alter table public.schedule_exceptions enable row level security;
alter table public.appointment_events enable row level security;

do $$
declare
  table_name text;
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    foreach table_name in array array[
      'organizations',
      'locations',
      'departments',
      'staff_assignments',
      'patients',
      'appointment_types',
      'schedule_templates',
      'template_shifts',
      'doctor_schedules',
      'schedule_exceptions',
      'appointment_events',
      'appointments',
      'profiles'
    ]
    loop
      execute format(
        'revoke all on table public.%I from anon, authenticated',
        table_name
      );
      execute format(
        'grant select, insert, update, delete on table public.%I to service_role',
        table_name
      );
    end loop;
  end if;
end $$;

notify pgrst, 'reload schema';
