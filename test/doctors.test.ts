import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";
import { createApp } from "../src/app";
import type { UserRole } from "../src/models/enums";
import { signAccessToken } from "../src/utils/jwt";
import { FakeAuthRepository } from "./helpers/fake-auth-repository";
import { FakeDoctorsRepository } from "./helpers/fake-doctors-repository";

const SECRET = new TextEncoder().encode("test-secret-that-is-long-enough-0123456789");
/* Tuesday 2026-11-24, 10:50 in Asia/Kolkata (UTC+05:30). */
const NOW = new Date("2026-11-24T05:20:00.000Z");
const TZ = "Asia/Kolkata";

const ANITA = "11111111-1111-4111-8111-111111111111"; // active, cardiology, has hours
const BHARAT = "22222222-2222-4222-8222-222222222222"; // active, dermatology
const CHETAN = "33333333-3333-4333-8333-333333333333"; // inactive, cardiology
const MISSING = "44444444-4444-4444-8444-444444444444";
const USER_ID = "8f0b6a1e-1c2d-4e5f-8a9b-0c1d2e3f4a5b";

type Json = Record<string, any>;

function seed(repo: FakeDoctorsRepository) {
  repo.addDoctor({
    id: ANITA,
    fullName: "Anita Rao",
    specialization: "Cardiology",
    qualification: "MBBS, MD",
    experienceYears: 12,
    consultationFee: 800,
    isActive: true,
  });
  repo.addDoctor({
    id: BHARAT,
    fullName: "Bharat Kumar",
    specialization: "Dermatology",
    qualification: "MBBS",
    experienceYears: 20,
    consultationFee: 500,
    isActive: true,
  });
  repo.addDoctor({
    id: CHETAN,
    fullName: "Chetan Iyer",
    specialization: "Cardiology",
    qualification: "MBBS",
    experienceYears: 5,
    consultationFee: 1000,
    isActive: false,
  });
  const block = (dayOfWeek: number, startTime: string, endTime: string, isActive = true) =>
    repo.schedules.push({ doctorId: ANITA, dayOfWeek, startTime, endTime, slotDurationMinutes: 30, isActive });
  block(2, "10:00:00", "13:00:00"); // Tuesday (today)
  block(3, "09:00:00", "12:00:00"); // Wednesday
  block(4, "10:00:00", "12:00:00"); // Thursday (day off on 2026-11-26)
  block(5, "16:00:00", "18:00:00", false); // Friday, switched off
  repo.daysOff.push({ doctorId: ANITA, startDate: "2026-11-26", endDate: "2026-11-27" });
  const book = (date: string, startTime: string, endTime: string, status: Parameters<typeof repo.appointments.push>[0]["status"]) =>
    repo.appointments.push({ doctorId: ANITA, date, startTime, endTime, status });
  book("2026-11-24", "12:00:00", "12:30:00", "scheduled");
  book("2026-11-25", "09:30:00", "10:00:00", "scheduled");
  book("2026-11-25", "10:00:00", "10:30:00", "cancelled");
  book("2026-11-25", "10:30:00", "11:00:00", "rescheduled");
  book("2026-11-25", "11:00:00", "11:30:00", "completed");
}

async function startApp() {
  const doctorsRepo = new FakeDoctorsRepository();
  seed(doctorsRepo);
  const app = createApp({
    auth: {
      repo: new FakeAuthRepository(),
      email: { send: async () => {} },
      settings: { jwtSecret: SECRET, accessTokenTtlSeconds: 900, refreshTokenTtlDays: 30, frontendUrl: undefined, appScheme: "agentdesk" },
      clock: () => NOW,
      defer: () => {},
    },
    doctors: { repo: doctorsRepo, clock: () => NOW, timeZone: TZ },
  });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`;

  async function call(method: string, path: string, options: { token?: string; auth?: string; body?: unknown } = {}) {
    const headers: Record<string, string> = {};
    if (options.body !== undefined) headers["Content-Type"] = "application/json";
    if (options.token) headers.Authorization = `Bearer ${options.token}`;
    if (options.auth) headers.Authorization = options.auth;
    const response = await fetch(base + path, {
      method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    const text = await response.text();
    return { status: response.status, json: (text ? JSON.parse(text) : {}) as Json, text, headers: response.headers };
  }

  return { repo: doctorsRepo, call, close: () => new Promise<void>((resolve) => server.close(() => resolve())) };
}

const tokenFor = (role: UserRole) => signAccessToken({ userId: USER_ID, role }, SECRET, 900, NOW);

/* Every doctors route, so the protection checks below cover all of them. */
const ROUTES: Array<[method: string, path: string]> = [
  ["GET", "/doctors"],
  ["GET", `/doctors/${ANITA}`],
  ["GET", `/doctors/${ANITA}/schedule`],
  ["GET", `/doctors/${ANITA}/availability?date=2026-11-25`],
  ["PATCH", `/doctors/${ANITA}`],
];

describe("doctors API", () => {
  let h: Awaited<ReturnType<typeof startApp>>;
  const tokens = {} as Record<UserRole, string>;

  before(async () => {
    h = await startApp();
    for (const role of ["admin", "receptionist", "doctor", "patient"] as const) tokens[role] = await tokenFor(role);
  });
  after(() => h.close());

  describe("protection", () => {
    it("rejects every route without a token, with a bad token, or with an expired token (401)", async () => {
      const expired = await signAccessToken({ userId: USER_ID, role: "admin" }, SECRET, 60, new Date(NOW.getTime() - 3_600_000));
      const forged = await signAccessToken(
        { userId: USER_ID, role: "admin" },
        new TextEncoder().encode("another-secret-that-is-long-enough-987654"),
        900,
        NOW,
      );
      for (const [method, path] of ROUTES) {
        for (const auth of [undefined, "Bearer not-a-jwt", `Bearer ${expired}`, `Bearer ${forged}`, `Basic ${tokens.admin}`]) {
          const res = await h.call(method, path, { auth, body: method === "PATCH" ? { isActive: true } : undefined });
          assert.equal(res.status, 401, `${method} ${path} with ${auth?.slice(0, 12)}`);
          assert.equal(res.json.error.code, "AUTH_INVALID_TOKEN");
        }
      }
    });

    it("checks the token before validating input", async () => {
      const res = await h.call("GET", "/doctors/not-a-uuid/availability?date=yesterday");
      assert.equal(res.status, 401);
      assert.equal(res.json.error.code, "AUTH_INVALID_TOKEN");
    });

    it("requires a token even for paths that do not exist under /doctors", async () => {
      assert.equal((await h.call("GET", `/doctors/${ANITA}/secret`)).status, 401);
      const signedIn = await h.call("GET", `/doctors/${ANITA}/secret`, { token: tokens.patient });
      assert.equal(signedIn.status, 404);
      assert.equal(signedIn.json.error.code, "NOT_FOUND");
    });

    it("lets only admins update a doctor, and checks the role before validating input", async () => {
      for (const role of ["patient", "doctor", "receptionist"] as const) {
        const valid = await h.call("PATCH", `/doctors/${ANITA}`, { token: tokens[role], body: { consultationFee: 1 } });
        assert.equal(valid.status, 403, role);
        assert.equal(valid.json.error.code, "AUTH_INSUFFICIENT_ROLE");
        const invalid = await h.call("PATCH", "/doctors/not-a-uuid", { token: tokens[role], body: { role: "admin" } });
        assert.equal(invalid.status, 403, `${role} with bad input`);
      }
      assert.equal(h.repo.doctors.get(ANITA)!.consultationFee, 800);
    });

    it("sends Cache-Control: no-store on doctors responses", async () => {
      const res = await h.call("GET", "/doctors", { token: tokens.patient });
      assert.equal(res.headers.get("cache-control"), "no-store");
    });

    it("refuses to build the app with a doctors API but no token verification", () => {
      assert.throws(() => createApp({ doctors: { repo: new FakeDoctorsRepository(), clock: () => NOW, timeZone: TZ } }));
    });
  });

  describe("GET /doctors", () => {
    it("lists active doctors only, by name, with paging info and no private fields", async () => {
      const res = await h.call("GET", "/doctors", { token: tokens.patient });
      assert.equal(res.status, 200, res.text);
      assert.deepEqual(
        res.json.data.doctors.map((d: Json) => d.fullName),
        ["Anita Rao", "Bharat Kumar"],
      );
      assert.deepEqual(res.json.data.pagination, { page: 1, pageSize: 20, total: 2, totalPages: 1 });
      assert.deepEqual(Object.keys(res.json.data.doctors[0]).sort(), [
        "consultationFee",
        "experienceYears",
        "fullName",
        "id",
        "isActive",
        "qualification",
        "specialization",
      ]);
    });

    it("pages, sorts by an allowed field, and filters by specialization ignoring case", async () => {
      const page2 = await h.call("GET", "/doctors?page=2&pageSize=1&sort=fee&order=desc", { token: tokens.doctor });
      assert.equal(page2.status, 200, page2.text);
      assert.deepEqual(page2.json.data.doctors.map((d: Json) => d.fullName), ["Bharat Kumar"]);
      assert.deepEqual(page2.json.data.pagination, { page: 2, pageSize: 1, total: 2, totalPages: 2 });

      const cardio = await h.call("GET", "/doctors?specialization=%20cardiology%20", { token: tokens.receptionist });
      assert.deepEqual(cardio.json.data.doctors.map((d: Json) => d.id), [ANITA]);
    });

    it("rejects bad paging, unknown sorts and unknown query keys (400)", async () => {
      for (const query of [
        "page=0",
        "page=abc",
        "page=1e3",
        "pageSize=101",
        "pageSize=-1",
        "page=1&page=2",
        "sort=password_hash",
        "order=sideways",
        "specialization=",
        `specialization=${"x".repeat(101)}`,
        "isActive=false",
      ]) {
        const res = await h.call("GET", `/doctors?${query}`, { token: tokens.admin });
        assert.equal(res.status, 400, query);
        assert.equal(res.json.error.code, "VALIDATION_ERROR");
        assert.ok(res.json.error.details.every((d: Json) => d.path.startsWith("query")), query);
      }
    });
  });

  describe("GET /doctors/:id and /schedule", () => {
    it("returns one doctor", async () => {
      const res = await h.call("GET", `/doctors/${ANITA}`, { token: tokens.patient });
      assert.equal(res.status, 200);
      assert.equal(res.json.data.doctor.fullName, "Anita Rao");
      assert.equal(res.json.data.doctor.consultationFee, 800);
    });

    it("rejects an invalid ID (400) and reports a missing one as DOCTOR_NOT_FOUND (404)", async () => {
      for (const path of ["/doctors/123", "/doctors/123/schedule"]) {
        const bad = await h.call("GET", path, { token: tokens.patient });
        assert.equal(bad.status, 400, path);
        assert.deepEqual(bad.json.error.details, [{ path: "params.id", rule: "invalid_format" }]);
        assert.ok(!bad.text.includes('"123"'), "the rejected value is not echoed back");
      }
      for (const path of [`/doctors/${MISSING}`, `/doctors/${MISSING}/schedule`, `/doctors/${MISSING}/availability?date=2026-11-25`]) {
        const missing = await h.call("GET", path, { token: tokens.patient });
        assert.equal(missing.status, 404, path);
        assert.equal(missing.json.error.code, "DOCTOR_NOT_FOUND");
      }
    });

    it("hides inactive doctors from everyone but admins, with the same 404 as a missing one", async () => {
      for (const role of ["patient", "doctor", "receptionist"] as const) {
        const res = await h.call("GET", `/doctors/${CHETAN}`, { token: tokens[role] });
        assert.equal(res.status, 404, role);
        assert.equal(res.json.error.code, "DOCTOR_NOT_FOUND");
      }
      const admin = await h.call("GET", `/doctors/${CHETAN}`, { token: tokens.admin });
      assert.equal(admin.status, 200);
      assert.equal(admin.json.data.doctor.isActive, false);
    });

    it("returns active weekly hours grouped by weekday", async () => {
      const res = await h.call("GET", `/doctors/${ANITA}/schedule`, { token: tokens.patient });
      assert.equal(res.status, 200, res.text);
      assert.deepEqual(res.json.data, {
        doctorId: ANITA,
        timezone: TZ,
        days: [
          { dayOfWeek: 2, blocks: [{ startTime: "10:00", endTime: "13:00", slotDurationMinutes: 30 }] },
          { dayOfWeek: 3, blocks: [{ startTime: "09:00", endTime: "12:00", slotDurationMinutes: 30 }] },
          { dayOfWeek: 4, blocks: [{ startTime: "10:00", endTime: "12:00", slotDurationMinutes: 30 }] },
        ],
      });
    });
  });

  describe("GET /doctors/:id/availability", () => {
    const slots = async (date: string, id = ANITA) => {
      const res = await h.call("GET", `/doctors/${id}/availability?date=${date}`, { token: tokens.patient });
      assert.equal(res.status, 200, res.text);
      return res.json.data.slots.map((s: Json) => s.startTime);
    };

    it("frees cancelled and rescheduled bookings and blocks the rest", async () => {
      assert.deepEqual(await slots("2026-11-25"), ["09:00", "10:00", "10:30", "11:30"]);
    });

    it("hides today's slots that start within 15 minutes (10:50 now → 11:00 hidden, 11:30 shown)", async () => {
      assert.deepEqual(await slots("2026-11-24"), ["11:30", "12:30"]);
    });

    it("returns no slots on a day off or on a day without active hours", async () => {
      assert.deepEqual(await slots("2026-11-26"), []); // Thursday, day off
      assert.deepEqual(await slots("2026-11-27"), []); // Friday, hours switched off
      assert.deepEqual(await slots("2026-11-25", BHARAT), []); // no hours at all
    });

    it("echoes the clinic time zone and the date", async () => {
      const res = await h.call("GET", `/doctors/${ANITA}/availability?date=2026-11-25`, { token: tokens.patient });
      assert.equal(res.json.data.timezone, TZ);
      assert.equal(res.json.data.date, "2026-11-25");
      assert.deepEqual(res.json.data.slots[0], { startTime: "09:00", endTime: "09:30" });
    });

    it("accepts today through 90 days ahead and rejects anything else (400)", async () => {
      assert.equal((await h.call("GET", `/doctors/${ANITA}/availability?date=2027-02-22`, { token: tokens.patient })).status, 200);
      for (const query of ["date=2026-11-23", "date=2027-02-23", "date=2026-02-30", "date=24-11-2026", "date=", "", "date=2026-11-25&extra=1"]) {
        const res = await h.call("GET", `/doctors/${ANITA}/availability?${query}`, { token: tokens.patient });
        assert.equal(res.status, 400, query);
        assert.equal(res.json.error.code, "VALIDATION_ERROR");
      }
    });
  });

  describe("PATCH /doctors/:id", () => {
    it("updates the allowed fields for an admin", async () => {
      const res = await h.call("PATCH", `/doctors/${BHARAT}`, {
        token: tokens.admin,
        body: { consultationFee: 650.5, experienceYears: 21, specialization: "  Dermatology  " },
      });
      assert.equal(res.status, 200, res.text);
      assert.equal(res.json.data.doctor.consultationFee, 650.5);
      assert.equal(res.json.data.doctor.experienceYears, 21);
      assert.equal(res.json.data.doctor.specialization, "Dermatology");
    });

    it("can deactivate and reactivate a doctor", async () => {
      await h.call("PATCH", `/doctors/${BHARAT}`, { token: tokens.admin, body: { isActive: false } });
      assert.equal((await h.call("GET", `/doctors/${BHARAT}`, { token: tokens.patient })).status, 404);
      await h.call("PATCH", `/doctors/${BHARAT}`, { token: tokens.admin, body: { isActive: true } });
      assert.equal((await h.call("GET", `/doctors/${BHARAT}`, { token: tokens.patient })).status, 200);
    });

    it("rejects empty, unknown, or out-of-range fields (400)", async () => {
      for (const body of [
        {},
        { profileId: USER_ID },
        { fullName: "New Name" },
        { consultationFee: 0 },
        { consultationFee: 10.555 },
        { consultationFee: "500" },
        { experienceYears: 1.5 },
        { experienceYears: -1 },
        { isActive: "yes" },
        { specialization: "   " },
      ]) {
        const res = await h.call("PATCH", `/doctors/${ANITA}`, { token: tokens.admin, body });
        assert.equal(res.status, 400, JSON.stringify(body));
        assert.equal(res.json.error.code, "VALIDATION_ERROR");
      }
      assert.equal(h.repo.doctors.get(ANITA)!.consultationFee, 800);
    });

    it("returns 404 for a doctor that does not exist", async () => {
      const res = await h.call("PATCH", `/doctors/${MISSING}`, { token: tokens.admin, body: { isActive: true } });
      assert.equal(res.status, 404);
      assert.equal(res.json.error.code, "DOCTOR_NOT_FOUND");
    });
  });
});
