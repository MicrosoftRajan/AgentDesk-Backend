import assert from "node:assert/strict";
import { describe, it } from "node:test";

process.env.SUPABASE_URL ??= "https://example.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "test-service-role-key";
process.env.COHERE_API_KEY ??= "test-cohere-key";

describe("patient booking rules that do not touch the database", () => {
  it("returns a closed day without asking which slots are taken", async () => {
    const { getBookableSlots } = await import(
      "../../src/modules/patients/patient.service.ts"
    );
    const now = new Date("2026-10-26T08:00:00+05:30");

    assert.deepEqual(await getBookableSlots("2026-11-01", now), {
      date: "2026-11-01",
      isOpen: false,
      slots: [],
    });
  });

  it("rejects a day outside the booking window before any query", async () => {
    const { getBookableSlots } = await import(
      "../../src/modules/patients/patient.service.ts"
    );
    const { HttpError } = await import("../../src/utils/http.ts");
    const now = new Date("2026-10-26T08:00:00+05:30");

    await assert.rejects(
      () => getBookableSlots("2026-12-26", now),
      (error: unknown) =>
        error instanceof HttpError && error.code === "OUT_OF_WINDOW",
    );
  });

  it("rejects a time that is not one of the published slots", async () => {
    const { bookOwnAppointment } = await import(
      "../../src/modules/patients/patient.service.ts"
    );
    const { HttpError } = await import("../../src/utils/http.ts");
    const now = new Date("2026-10-26T08:00:00+05:30");

    await assert.rejects(
      () =>
        bookOwnAppointment(
          "3f1c2a40-6b7e-4d2a-9c11-0a1b2c3d4e5f",
          { scheduledAt: "2026-10-27T10:15:00+05:30" },
          now,
        ),
      (error: unknown) =>
        error instanceof HttpError && error.code === "INVALID_SLOT",
    );
  });

  it("rejects a published slot that starts in less than an hour", async () => {
    const { bookOwnAppointment } = await import(
      "../../src/modules/patients/patient.service.ts"
    );
    const { HttpError } = await import("../../src/utils/http.ts");
    const now = new Date("2026-10-26T09:30:00+05:30");

    await assert.rejects(
      () =>
        bookOwnAppointment(
          "3f1c2a40-6b7e-4d2a-9c11-0a1b2c3d4e5f",
          { scheduledAt: "2026-10-26T10:00:00+05:30" },
          now,
        ),
      (error: unknown) => error instanceof HttpError && error.code === "TOO_SOON",
    );
  });

  it("rejects a blank reason after the slot is accepted", async () => {
    const { bookOwnAppointment } = await import(
      "../../src/modules/patients/patient.service.ts"
    );
    const { HttpError } = await import("../../src/utils/http.ts");
    const now = new Date("2026-10-26T09:30:00+05:30");

    await assert.rejects(
      () =>
        bookOwnAppointment(
          "3f1c2a40-6b7e-4d2a-9c11-0a1b2c3d4e5f",
          { scheduledAt: "2026-10-26T11:00:00+05:30", reason: "   " },
          now,
        ),
      (error: unknown) =>
        error instanceof HttpError && error.code === "INVALID_REASON",
    );
  });
});
