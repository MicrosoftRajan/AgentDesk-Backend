import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  clinicDayStart,
  isBookableInTime,
  isClinicOpen,
  isWithinBookingWindow,
  istDayBounds,
  slotsForDay,
} from "../../src/modules/appointments/clinicSchedule.ts";

const MONDAY = new Date("2026-10-26T08:00:00+05:30");

describe("clinic schedule", () => {
  it("closes Sunday and opens Monday", () => {
    assert.equal(isClinicOpen("2026-10-25"), false);
    assert.equal(isClinicOpen("2026-10-26"), true);
  });

  it("publishes 16 half-hour slots from 10:00 through 17:30 IST", () => {
    const slots = slotsForDay("2026-10-26");

    assert.equal(slots.length, 16);
    assert.equal(slots[0], "2026-10-26T04:30:00.000Z");
    assert.equal(slots[15], "2026-10-26T12:00:00.000Z");
    assert.deepEqual(slotsForDay("2026-10-25"), []);
  });

  it("rejects calendar overflow for patient slots and still parses it for the staff day list", () => {
    assert.equal(clinicDayStart("2026-02-31"), null);
    assert.equal(clinicDayStart("2026-13-01"), null);
    assert.ok(istDayBounds("2026-02-31"));
    assert.equal(istDayBounds("2026-13-01"), null);
    assert.equal(istDayBounds("not-a-date"), null);
  });

  it("limits booking to today through 30 clinic days ahead", () => {
    assert.equal(isWithinBookingWindow("2026-10-26", MONDAY), true);
    assert.equal(isWithinBookingWindow("2026-11-25", MONDAY), true);
    assert.equal(isWithinBookingWindow("2026-11-26", MONDAY), false);
    assert.equal(isWithinBookingWindow("2026-10-25", MONDAY), false);
  });

  it("requires one hour of lead time", () => {
    const now = new Date("2026-10-26T09:00:00+05:30");

    assert.equal(isBookableInTime("2026-10-26T04:30:00.000Z", now), true);
    assert.equal(isBookableInTime("2026-10-26T04:00:00.000Z", now), false);
  });
});
