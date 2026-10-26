# AgentDesk API contract

Base URL in local development: `http://localhost:3000`.

The Expo app sends `Authorization: Bearer <supabase access token>` and `Content-Type: application/json`. Paths below are stable. Do not rename `/api/v1/patient` to `/patients`.

## Envelope

Success:

```json
{ "success": true, "data": {} }
```

Failure:

```json
{
  "success": false,
  "error": { "code": "SOME_CODE", "message": "What the client can show" }
}
```

`message` is safe to show in the app. `code` is stable for branching. Unknown routes use `NOT_FOUND`. A body that is not JSON uses `INVALID_JSON`.

## Auth

| | |
| --- | --- |
| Missing token | `401 UNAUTHENTICATED` |
| Token rejected by Supabase Auth | `401 INVALID_TOKEN` |
| Supabase Auth unreachable | `503 AUTH_UNAVAILABLE` |
| Signed in, wrong role | `403 FORBIDDEN` |
| Profile table unreachable | `503 ROLE_UNAVAILABLE` |

The role is read from `profiles` after the token is verified. The client cannot set it.

## Account

### `GET /api/v1/me`

Any signed-in user.

```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "email": "person@example.com",
    "role": "patient",
    "fullName": "Asha Rao",
    "phone": "+919876543210"
  }
}
```

`role` is `staff` or `patient`. `fullName` and `phone` are `null` until the patient saves them. A new auth user gets a `patient` profile on this call.

### `PUT /api/v1/patient/profile`

Role: `patient`.

Request:

```json
{ "fullName": "Asha Rao", "phone": "+919876543210" }
```

Response `data` matches `GET /api/v1/me`, including `email` from the verified session. The role is not accepted in the body.

| Code | When |
| --- | --- |
| `INVALID_NAME` | Missing, blank, or longer than 100 characters |
| `INVALID_PHONE` | Does not match a 7–20 character phone |
| `PROFILE_UPDATE_FAILED` | Save failed |

## Staff appointments

Role: `staff`. Responses include `patientName` and `patientPhone`.

Appointment fields:

| Field | Type |
| --- | --- |
| `id` | uuid |
| `patientName` | string |
| `patientPhone` | string |
| `reason` | string or null |
| `scheduledAt` | ISO timestamp |
| `status` | `scheduled`, `cancelled`, `completed`, `no_show` |
| `cancelReason` | string or null |
| `lastReminderAt` | ISO timestamp or null |

### `GET /api/v1/appointments?date=YYYY-MM-DD`

One clinic day in `Asia/Kolkata`. `date` defaults to today. At most 200 rows, earliest first.

```json
{
  "success": true,
  "data": { "date": "2026-10-26", "appointments": [] }
}
```

| Code | When |
| --- | --- |
| `INVALID_DATE` | `date` is not `YYYY-MM-DD` or not a parseable day |
| `APPOINTMENTS_FAILED` | Query failed |

`2026-02-31` is currently accepted and rolls forward. Do not rely on that.

### `GET /api/v1/appointments/:id`

One appointment, same fields, wrapped as `{ "appointment": { ... } }`.

| Code | When |
| --- | --- |
| `INVALID_ID` | Not a uuid |
| `NOT_FOUND` | No row |
| `APPOINTMENT_FAILED` | Query failed |

Staff create, reschedule, and cancel are not REST endpoints. Those writes go through the agent tools so cancellation stays behind approval. The live table has no doctor, location, or duration column, so this API does not accept them.

## Patient appointments

Role: `patient`. The user id is taken from the verified token. These payloads omit phone numbers.

Patient appointment:

| Field | Type |
| --- | --- |
| `id` | uuid |
| `reason` | string or null |
| `scheduledAt` | ISO timestamp |
| `status` | `scheduled`, `cancelled`, `completed`, `no_show` |
| `cancelReason` | string or null |

### `GET /api/v1/patient/slots?date=YYYY-MM-DD`

`date` defaults to the clinic's today. The window is today through 30 days ahead. Sunday is closed. Slots are every 30 minutes from 10:00 to 17:30 IST, at least one hour from now. Taken slots are omitted, and the response does not say who holds them.

Open day:

```json
{
  "success": true,
  "data": {
    "date": "2026-10-26",
    "isOpen": true,
    "slots": [{ "startsAt": "2026-10-26T04:30:00.000Z" }]
  }
}
```

Closed day inside the window: `isOpen: false` and `slots: []`, HTTP 200.

| Code | When |
| --- | --- |
| `INVALID_DATE` | Not a real `YYYY-MM-DD`. Overflow dates such as 31 February are rejected |
| `OUT_OF_WINDOW` | Before today or more than 30 days ahead |
| `SLOTS_FAILED` | Query failed |

### `GET /api/v1/patient/appointments`

The caller's rows only, newest first, at most 100.

```json
{ "success": true, "data": { "appointments": [] } }
```

`LIST_FAILED` when the query fails.

### `POST /api/v1/patient/appointments`

```json
{ "scheduledAt": "2026-10-26T11:00:00+05:30", "reason": "follow-up" }
```

`reason` is optional. Empty string means no reason. The time must be one of the published slot instants. Name and phone must already be on the profile. A patient may have at most 3 upcoming `scheduled` appointments. The unique index on a live `scheduled_at` rejects a double book.

HTTP 201:

```json
{ "success": true, "data": { "appointment": {} } }
```

| Code | When |
| --- | --- |
| `INVALID_TIME` | Missing or unparseable `scheduledAt` |
| `INVALID_SLOT` | Not a published slot in the booking window |
| `TOO_SOON` | Starts in less than one hour |
| `INVALID_REASON` | Present but blank or longer than 200 characters |
| `PROFILE_INCOMPLETE` | Name or phone not saved |
| `TOO_MANY_APPOINTMENTS` | Already 3 upcoming |
| `SLOT_TAKEN` | Another booking won the slot |
| `BOOK_FAILED` | Other failure |

### `POST /api/v1/patient/appointments/:id/cancel`

No body. Only the caller's own future `scheduled` appointment. Sets `cancelled` and `cancel_reason` to `Cancelled by patient`. An id that belongs to someone else is `NOT_FOUND`.

HTTP 200: `{ "success": true, "data": { "appointment": {} } }`.

| Code | When |
| --- | --- |
| `INVALID_ID` | Not a uuid |
| `NOT_FOUND` | Missing, or not this patient's |
| `NOT_CANCELLABLE` | Status is not `scheduled` |
| `ALREADY_PASSED` | Start time is now or earlier |
| `CHANGED` | The row changed between the read and the update |
| `CANCEL_FAILED` | Other failure |

There is no patient reschedule endpoint. The table can store a new time, and the agent tool can move a scheduled appointment, but the patient app does not have that workflow.

## Agent

Role: `staff`. Prefix: `/api/v1/agents`.

| Method and path | Purpose |
| --- | --- |
| `POST /runs` | Body `{ "goal": "..." }`. Creates a run and executes it on this request. HTTP 201. `goal` is required, trimmed, and at most 2000 characters. |
| `GET /runs?limit=` | Newest runs. `limit` defaults to 50 and caps at 100. |
| `GET /runs/:runId` | Run, message log, and pending approval if any |
| `POST /runs/:runId/approve` | Runs the approved tool and continues |
| `POST /runs/:runId/reject` | Cancels the run. The tool does not run |

Run `data`:

```json
{
  "id": "uuid",
  "goal": "text",
  "status": "completed",
  "createdAt": "ISO",
  "response": "text or null",
  "completedAt": "ISO or null",
  "pendingApproval": null
}
```

`pendingApproval` is present on create, approve, and reject. It is also present on the detail payload. List items do not include it. Detail adds `messages`: `{ id, role, content, createdAt }`. `role` is `user`, `assistant`, `tool`, or `system`.

Run status: `pending`, `running`, `awaiting_approval`, `completed`, `failed`, `cancelled`.

Approval object: `id`, `runId`, `toolName`, `toolInput`, `riskLevel` (`low`, `medium`, `high`), `status` (`pending`, `approved`, `rejected`, `expired`), `createdAt`, `expiresAt`, `resolvedAt`, and optional `summary` (`{ title, lines: [{ label, value }] }`). The checkpoint stored for resume is never returned.

| Code | When |
| --- | --- |
| `INVALID_REQUEST` | Goal missing or too long |
| `INVALID_LIMIT` | `limit` is not a positive integer |
| `INVALID_ID` | `runId` is not a uuid |
| `NOT_FOUND` | Run does not exist, or no approval to resolve |
| `CONFLICT` | Run is not waiting, or the approval was already resolved or expired |
| `AGENT_RUN_FAILED` | Create/execute failed |
| `AGENT_RUNS_FAILED` | List failed |
| `AGENT_RUN_FETCH_FAILED` | Detail failed |
| `AGENT_DECISION_FAILED` | Approve or reject failed |

A `500` from these routes can include an internal error string in `message`. Treat it as operational detail, not a stable client message.

The model cannot approve itself. Medium and high risk tools pause for `POST .../approve`. Low risk tools, including book and reschedule, run without that pause. `send_reminder` records `last_reminder_at` and returns `simulated: true`. `issue_refund` does not move money and returns `simulated: true`.

## What this API will not accept

The proposed multi-location model (organizations, doctors, schedules, `pending` visits, `canceled` spelling) is documentation only. Requests that send `doctorId`, `locationId`, or a status this table does not store are not part of the contract and are ignored or rejected by validation that only knows the current columns.
