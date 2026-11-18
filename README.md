# AgentDesk API

Express 5 server for the AgentDesk clinic app. Login is custom code in this process. Supabase is the PostgreSQL host only. The Expo app never connects to the database.

What runs today is authentication: signup, sign-in, refresh, logout, the current user, password reset, and email verification. Doctors, patients, appointments, approval cards, and notifications are Drizzle table definitions only. Those routes are not built.

Design detail lives in [`docs/AUTHENTICATION.md`](../docs/AUTHENTICATION.md) and [`docs/03-architecture.md`](../docs/03-architecture.md). This file is how to run and check the server.

## Requirements

- Node.js 24.7 or newer. Password hashing uses the built-in `node:crypto` Argon2id API.
- A Supabase Postgres database and the `agentdesk_app` login role from [`sql/000-app-runtime-role.sql`](sql/000-app-runtime-role.sql).
- A Resend API key and a verified sender address. The process will not start without them. A failed send does not undo a saved account.

Install dependencies from the repository root (`npm install`). This package is the `backend` workspace.

## Configure

```bash
cp .env.example .env
```

Fill in `.env`. Never commit it. The variables and their rules are in [`.env.example`](.env.example). Names that must be set:

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | `agentdesk_app` connection string. `postgres` and `supabase_admin` are refused. Do not put SSL parameters in the URL. |
| `DATABASE_CA_CERT_PATH` | PEM file for the database CA, relative to `backend/`. |
| `JWT_SECRET` | HS256 signing key, at least 32 bytes. `openssl rand -base64 48` |
| `RESEND_API_KEY` | Resend key. It must start with `re_`. |
| `EMAIL_FROM` | Sender address, or `Name <address>`. |

`PORT` defaults to 3000. Access tokens default to 15 minutes. Refresh tokens default to 30 days.

## Run

From `backend/`:

```bash
npm run dev        # http://localhost:3000, reloads on file changes
```

From the repository root, `npm run dev:backend` does the same thing.

`npm run dev` exits before listening when a required variable is missing. The message names the variable, never the value. Wait for `API listening on port 3000`.

Production build:

```bash
npm run build
npm start
```

## Check it

Health does not touch the database:

```bash
curl http://localhost:3000/api/v1/health
```

`200` and `{"ok":true}` means the process is up.

Signup writes a patient account. Use an email that is not already registered:

```bash
curl -sS -X POST http://localhost:3000/api/v1/auth/signup \
  -H 'Content-Type: application/json' \
  -d '{"fullName":"Test Patient","email":"you@example.com","phone":"+919812345678","password":"test-password","confirmPassword":"test-password"}'
```

`201` returns `data.user` and `data.tokens`. Then:

1. `GET /api/v1/auth/me` with header `Authorization: Bearer <accessToken>`.
2. `POST /api/v1/auth/signin` with the same email and password.
3. `POST /api/v1/auth/refresh` with `{ "refreshToken": "<refreshToken>" }`. Sending that same refresh token again returns `401` and `INVALID_REFRESH_TOKEN`, and the server log says the session family was revoked.
4. Sign in again, then `POST /api/v1/auth/logout` with the new refresh token. That returns `204`. Refresh with the same token returns `401`.

Postman uses the same URLs. JSON goes in **Body → raw → JSON**. The access token goes in **Authorization → Bearer Token**. The refresh token goes in the JSON body, not in that tab.

## Auth routes

Base path: `/api/v1/auth`. Every auth response uses `{ "success", "data" | "error", "meta" }`, except logout, which is empty `204`. Health is `{ "ok": true }` and does not use that envelope.

| Method | Path | Auth | Success |
|---|---|---|---|
| `POST` | `/signup` | Public | `201` user + tokens. Role is always `patient`. |
| `POST` | `/signin` | Public | `200` user + tokens |
| `POST` | `/refresh` | Refresh token in the body | `200` new tokens. The previous refresh token is spent. |
| `POST` | `/logout` | Refresh token in the body | `204`. Unknown tokens also return `204`. |
| `GET` | `/me` | Bearer access token | `200` user |
| `POST` | `/forgot-password` | Public | `202`, whether or not the email exists |
| `POST` | `/reset-password` | Token from the email | `200`. Ends every session for that user. |
| `POST` | `/verify-email` | Token from the email | `200` |
| `POST` | `/resend-verification` | Bearer access token | `202` |

Public signup rejects a body that contains `role`. Passwords are 8 to 128 characters. Phone, when sent, is E.164 and at most 15 characters, for example `+919812345678`.

Access tokens are HS256 JWTs with the user id and role only. They last 15 minutes by default and stay valid until they expire, including after logout. Refresh tokens are random, stored as SHA-256 hashes, and rotate. Reuse of a spent refresh token revokes that whole sign-in.

Password reset and verification links are emailed through Resend after the database change is saved. Until `RESEND_API_KEY` and `EMAIL_FROM` are real, those routes still return success and the server logs `auth email not sent`.

## Request order

Helmet, then CORS for `http://localhost:8081` and `http://127.0.0.1:8081`, then 100 requests per minute per client, then a JSON body limit of 100 KB. Auth routes add their own limits, then Zod validation, then the handler. `requireRole` exists for later staff routes and is not attached to a public route yet.

Rate-limit counters live in this process. Behind a reverse proxy they see the proxy address until `trust proxy` is set on purpose.

## Database

Drizzle models in `src/models/` are the table definitions. The runtime role is `agentdesk_app`: it can log in, it is not a superuser, and it does not bypass row-level security. TLS uses the pinned CA in `DATABASE_CA_CERT_PATH`.

The connected database currently has the five auth tables, with row-level security off:

- `users`
- `profiles`
- `refresh_tokens`
- `password_reset_tokens`
- `email_verification_tokens`

`agentdesk_app` can `SELECT`, `INSERT`, and `UPDATE` those tables and cannot `DELETE` them. The other model tables (`doctors`, `patients`, `appointments`, and the rest) are not created yet.

## Tests

```bash
npm test
npm run typecheck
```

Auth tests use an in-memory repository. They do not need Postgres. A live signup against `npm run dev` is the check that the database accepts a write.

## Layout

```
src/index.ts                 start: env, database pool, HTTP server
src/app.ts                   middleware and routes
src/modules/auth/            signup, sign-in, tokens, email links
src/models/                  Drizzle tables
src/config/                  env rules and the Postgres pool
sql/000-app-runtime-role.sql restricted database role
```

`src/modules/doctors`, `patients`, `appointments`, `ai`, and `notifications` are empty. Cohere is not called from this server yet.
