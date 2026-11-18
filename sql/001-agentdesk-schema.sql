-- AgentDesk tables, matching backend/src/models. Run once, as postgres, on an empty public schema.
-- agentdesk_app receives the least privilege from prompts/14. anon and authenticated receive none.

begin;

do $$
begin
  if exists (
    select 1
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'
  ) then
    raise exception 'public schema is not empty; refusing to create AgentDesk tables';
  end if;
end
$$;

create type public.user_role as enum ('admin', 'receptionist', 'doctor', 'patient');
create type public.gender as enum ('male', 'female', 'other');
create type public.appointment_status as enum ('scheduled', 'completed', 'cancelled', 'no_show', 'rescheduled');
create type public.action_type as enum ('book', 'reschedule', 'cancel');
create type public.action_status as enum ('pending', 'approved', 'rejected', 'expired');
create type public.notification_type as enum ('booked', 'rescheduled', 'cancelled', 'reminder', 'action_pending');

create table public.users (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  password_hash text not null,
  email_verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index users_email_lower_unique on public.users (lower(email));

create table public.profiles (
  id uuid primary key references public.users (id) on delete cascade,
  full_name varchar(100) not null,
  phone varchar(15) constraint profiles_phone_unique unique,
  role public.user_role not null,
  language_preference varchar(5) not null default 'en',
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_profiles_role on public.profiles (role);

create table public.doctors (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null constraint doctors_profile_id_unique unique references public.profiles (id),
  specialization varchar(100) not null,
  qualification varchar(200) not null,
  experience_years integer not null,
  consultation_fee numeric(10, 2) not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint doctors_experience_years_check check (experience_years >= 0),
  constraint doctors_consultation_fee_check check (consultation_fee > 0)
);
create index idx_doctors_specialization on public.doctors (specialization);
create index idx_doctors_is_active on public.doctors (is_active);

create table public.doctor_schedules (
  id uuid primary key default gen_random_uuid(),
  doctor_id uuid not null references public.doctors (id) on delete cascade,
  day_of_week smallint not null,
  start_time time not null,
  end_time time not null,
  slot_duration_minutes integer not null default 30,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint doctor_schedules_day_of_week_check check (day_of_week between 0 and 6),
  constraint doctor_schedules_time_order_check check (end_time > start_time),
  constraint doctor_schedules_doctor_day_start_unique unique (doctor_id, day_of_week, start_time)
);
create index idx_schedules_doctor_day on public.doctor_schedules (doctor_id, day_of_week);

create table public.doctor_unavailability (
  id uuid primary key default gen_random_uuid(),
  doctor_id uuid not null references public.doctors (id) on delete cascade,
  start_date date not null,
  end_date date not null,
  reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint doctor_unavailability_date_order_check check (end_date >= start_date)
);
create index idx_unavailability_doctor_dates on public.doctor_unavailability (doctor_id, start_date, end_date);

create table public.patients (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid constraint patients_profile_id_unique unique references public.profiles (id),
  full_name varchar(100) not null,
  phone varchar(15) not null,
  email varchar(100),
  date_of_birth date not null,
  gender public.gender not null,
  address text,
  medical_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_patients_phone on public.patients (phone);
create index idx_patients_name on public.patients (full_name);

create table public.appointments (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients (id) on delete restrict,
  doctor_id uuid not null references public.doctors (id) on delete restrict,
  appointment_date date not null,
  start_time time not null,
  end_time time not null,
  status public.appointment_status not null default 'scheduled',
  reason text,
  notes text,
  booked_by uuid not null references public.profiles (id),
  rescheduled_from uuid constraint appointments_rescheduled_from_unique unique references public.appointments (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint appointments_time_order_check check (end_time > start_time)
);
create unique index unique_active_doctor_slot on public.appointments (doctor_id, appointment_date, start_time)
  where status not in ('cancelled', 'rescheduled');
create index idx_appointments_patient on public.appointments (patient_id);
create index idx_appointments_doctor_date on public.appointments (doctor_id, appointment_date);
create index idx_appointments_status on public.appointments (status);
create index idx_appointments_date on public.appointments (appointment_date);

create table public.ai_actions (
  id uuid primary key default gen_random_uuid(),
  action_type public.action_type not null,
  status public.action_status not null default 'pending',
  requested_by uuid not null references public.profiles (id),
  doctor_id uuid references public.doctors (id),
  related_patient_id uuid references public.patients (id),
  related_appointment_id uuid references public.appointments (id),
  payload jsonb not null,
  ai_summary text not null,
  user_input text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_ai_actions_status on public.ai_actions (status);
create index idx_ai_actions_requested_by on public.ai_actions (requested_by);
create index idx_ai_actions_doctor on public.ai_actions (doctor_id);

create table public.action_history (
  id uuid primary key default gen_random_uuid(),
  ai_action_id uuid constraint action_history_ai_action_id_unique unique references public.ai_actions (id),
  action_type public.action_type not null,
  performed_by uuid not null references public.profiles (id),
  approved_by uuid references public.profiles (id),
  appointment_id uuid references public.appointments (id),
  before_state jsonb,
  after_state jsonb not null,
  description text not null,
  executed_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index idx_history_performed_by on public.action_history (performed_by);
create index idx_history_executed_at on public.action_history (executed_at);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id),
  title varchar(200) not null,
  message text not null,
  type public.notification_type not null,
  is_read boolean not null default false,
  related_appointment_id uuid references public.appointments (id),
  related_ai_action_id uuid references public.ai_actions (id),
  created_at timestamptz not null default now()
);
create index idx_notifications_user_unread on public.notifications (user_id, is_read) where is_read = false;
create index idx_notifications_ai_action on public.notifications (related_ai_action_id);

create table public.refresh_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  family_id uuid not null default gen_random_uuid(),
  token_hash text not null constraint refresh_tokens_token_hash_unique unique,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  replaced_by_id uuid references public.refresh_tokens (id),
  created_at timestamptz not null default now()
);
create index idx_refresh_tokens_user on public.refresh_tokens (user_id);
create index idx_refresh_tokens_family on public.refresh_tokens (family_id);

create table public.password_reset_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  token_hash text not null constraint password_reset_tokens_token_hash_unique unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create index idx_password_reset_tokens_user on public.password_reset_tokens (user_id);

create table public.email_verification_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  token_hash text not null constraint email_verification_tokens_token_hash_unique unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create index idx_email_verification_tokens_user on public.email_verification_tokens (user_id);

revoke all on table
  public.users,
  public.profiles,
  public.doctors,
  public.doctor_schedules,
  public.doctor_unavailability,
  public.patients,
  public.appointments,
  public.ai_actions,
  public.action_history,
  public.notifications,
  public.refresh_tokens,
  public.password_reset_tokens,
  public.email_verification_tokens
from public, anon, authenticated;

grant select, insert, update on public.users, public.profiles, public.doctors, public.patients to agentdesk_app;
grant select, insert, update, delete on public.doctor_schedules, public.doctor_unavailability to agentdesk_app;
grant select, insert, update on public.appointments, public.ai_actions, public.notifications to agentdesk_app;
grant select, insert on public.action_history to agentdesk_app;
grant select, insert, update on public.refresh_tokens, public.password_reset_tokens, public.email_verification_tokens to agentdesk_app;

commit;
