# AgentDesk Backend

Express API for AgentDesk. It verifies Supabase sessions, reads and writes clinic data with the Supabase service-role key, and runs the existing front-desk agent through Cohere.

The Expo app lives in the sibling `Frontend` folder. This service keeps `src/` at the top of `Backend`.

The HTTP contract for that app is [docs/API.md](docs/API.md).

## Layout

```
src/
  app.ts, server.ts
  config/            environment, Supabase, Cohere
  middleware/        authentication, roles, request log, errors
  routes/v1/         endpoint paths
  modules/
    appointments/    clinic hours, appointment queries, staff reads
    patients/        patient profile, slots, book, cancel
    profiles/        role and contact details
    ai-agent/        existing Cohere agent, guardrails, tools
supabase/migrations/ versioned SQL, 001 through 005
tests/unit
tests/integration
```

There is no `doctors/` or `staff/` module. The live database has two roles, `staff` and `patient`, and no doctor, location, or department tables. Those tables are described in [docs/DATA_MODEL.md](docs/DATA_MODEL.md) and are not implemented.

## Prerequisites

- Node.js 20 or newer
- npm
- A Supabase project
- A Cohere API key, required to start the process because the agent client is created at startup

## Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Create a local env file:

   ```bash
   cp .env.example .env
   ```

3. Fill in `.env`. Do not commit that file.

   | Variable | Purpose |
   | --- | --- |
   | `PORT` | HTTP port. Defaults to `3000`. |
   | `NODE_ENV` | `development` or `production`. |
   | `COHERE_API_KEY` | Cohere API key used by the agent. |
   | `SUPABASE_URL` | Supabase project URL. |
   | `SUPABASE_SERVICE_ROLE_KEY` | Server-only key. It bypasses row-level security. |

## Run

Development, with reload on save:

```bash
npm run dev
```

Production-style start:

```bash
npm run build
npm start
```

The process listens on `http://localhost:3000` unless `PORT` is set.

`npm start` runs compiled output in `dist/`. Run `npm run build` after source changes before `npm start`.

## Health check

```bash
curl http://localhost:3000/health
```

A healthy process returns HTTP 200 and JSON with `success: true` and `data.status` of `ok`.

## Migrations

SQL lives in `supabase/migrations/` and is applied by hand, in numeric order, in the Supabase SQL editor. This repository does not run migrations on startup and does not reset data.

| File | What it does |
| --- | --- |
| `001_agent_runs.sql` | Creates `agent_runs` if it is missing, and enables row-level security. Reconstructed because the original file was not in the repo. Safe to run on a database that already has the table: `CREATE TABLE IF NOT EXISTS` does not alter or delete it. |
| `002_messages.sql` | `messages`, plus an index on `agent_runs`. |
| `003_approvals.sql` | Extends the run status check and creates `approval_requests`. |
| `004_appointments.sql` | `appointments`. |
| `005_patient_portal.sql` | `profiles`, `appointments.patient_user_id`, and marks existing auth users as `staff`. |

`003` drops and recreates the status check on `agent_runs`. Read it before running it on a database that already has that table. Do not run `005`'s staff backfill twice and expect a different result: the insert uses `ON CONFLICT DO NOTHING`, so existing profile rows stay as they are.

There is no seed file. There is no Supabase CLI `config.toml` because this project is not linked to the CLI.

## Tests

```bash
npm run typecheck
npm test
```

Unit tests cover clinic hours, patient payload checks, booking rules that fail before a query, and the agent guardrail. The HTTP test starts the app on an ephemeral port and checks `/health`, unauthenticated routes, unknown routes, and invalid JSON.

There is no ESLint config in this repository. `npm run typecheck` is the static check.

These tests do not call Cohere and do not write to the database. A passing test run does not prove that the live Supabase project accepts the queries.

## Security notes

- Identity comes from `supabase.auth.getUser(token)`. A user id or role in the body is ignored.
- A missing profile is created as `patient`. Staff is granted only in SQL: `update profiles set role = 'staff' where id = '<auth user id>';`
- Row-level security is enabled with no policies. The anon key cannot read these tables. The API uses the service role, so the API is the authorization boundary. Keep that key on the server.
- Request logs record method, path, status, and duration. They omit query strings, headers, and bodies.
- Patient slot responses do not say who booked a taken time. A patient cancel that does not belong to the caller returns not found.
- Staff appointment reads return name and phone. Patients do not receive those fields on their own appointment payload.
- Cancel, refund, and delete-document agent tools stay behind human approval. Booking, rescheduling, no-show, and reminders are low risk and run when the model calls them. `send_reminder` and `issue_refund` are still simulated.

## Open issues

- CORS allows any origin (`origin: true`).
- Agent routes are synchronous and can hold the HTTP request for several model calls.
- `agent_runs` has no owner column, so every staff member can read every run.
- Agent `500` responses still include the internal error message.
- Invalid dates such as `2026-02-31` roll forward in the staff day list and the agent search. Patient slot generation rejects them.
- The multi-location schema in `docs/DATA_MODEL.md` and `docs/ER_DIAGRAMS.md` is a proposal. It is not the database this API uses.
- No rate limit, audit table, or request id.
- Migration `001` has been added to the repo and has not been applied by this change.
