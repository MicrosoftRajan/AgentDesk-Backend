import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { computeFreeSlots, type AvailabilityInput } from "../src/modules/doctors/doctors.availability";
import { addDays, clinicNow, isIsoDate, weekdayOf } from "../src/utils/clinic-time";

const base: AvailabilityInput = {
  isActive: true,
  blocks: [{ startTime: "10:00:00", endTime: "12:00:00", slotDurationMinutes: 30 }],
  onDayOff: false,
  booked: [],
  date: "2026-11-25",
  today: "2026-11-24",
  nowMinutes: 10 * 60 + 50,
};
const starts = (input: Partial<AvailabilityInput>) => computeFreeSlots({ ...base, ...input }).map((s) => s.startTime);

describe("computeFreeSlots", () => {
  it("cuts weekly hours into slots that fit completely", () => {
    assert.deepEqual(starts({}), ["10:00", "10:30", "11:00", "11:30"]);
    assert.deepEqual(starts({ blocks: [{ startTime: "10:00", endTime: "11:10", slotDurationMinutes: 30 }] }), ["10:00", "10:30"]);
  });

  it("merges several blocks in order without duplicates", () => {
    const blocks = [
      { startTime: "16:00", endTime: "17:00", slotDurationMinutes: 30 },
      { startTime: "09:00", endTime: "10:00", slotDurationMinutes: 30 },
      { startTime: "09:00", endTime: "09:30", slotDurationMinutes: 30 },
    ];
    assert.deepEqual(starts({ blocks }), ["09:00", "09:30", "16:00", "16:30"]);
  });

  it("blocks booked slots, including bookings that only overlap part of a slot", () => {
    assert.deepEqual(starts({ booked: [{ startTime: "10:30:00", endTime: "11:00:00" }] }), ["10:00", "11:00", "11:30"]);
    assert.deepEqual(starts({ booked: [{ startTime: "10:15", endTime: "10:45" }] }), ["11:00", "11:30"]);
    assert.deepEqual(starts({ booked: [{ startTime: "11:00", endTime: "11:30" }] }), ["10:00", "10:30", "11:30"]);
  });

  it("returns nothing on a day off, for an inactive doctor, or for a past date", () => {
    assert.deepEqual(starts({ onDayOff: true }), []);
    assert.deepEqual(starts({ isActive: false }), []);
    assert.deepEqual(starts({ date: "2026-11-23" }), []);
  });

  it("on today, hides slots that start within the next 15 minutes", () => {
    assert.deepEqual(starts({ date: "2026-11-24" }), ["11:30"]); // 10:50 → earliest 11:05
    assert.deepEqual(starts({ date: "2026-11-24", nowMinutes: 9 * 60 + 45 }), ["10:00", "10:30", "11:00", "11:30"]); // 10:00 exactly 15 min away
    assert.deepEqual(starts({ date: "2026-11-24", nowMinutes: 9 * 60 + 46 }), ["10:30", "11:00", "11:30"]);
  });

  it("ignores blocks with a non-positive slot length instead of looping forever", () => {
    assert.deepEqual(starts({ blocks: [{ startTime: "10:00", endTime: "12:00", slotDurationMinutes: 0 }] }), []);
  });
});

describe("clinic time", () => {
  it("uses the clinic's date, not UTC's, around midnight", () => {
    // 18:45 UTC on the 24th is 00:15 on the 25th in India.
    assert.deepEqual(clinicNow(new Date("2026-11-24T18:45:00Z"), "Asia/Kolkata"), { date: "2026-11-25", minutes: 15 });
    // 18:15 UTC is still 23:45 on the 24th in India.
    assert.deepEqual(clinicNow(new Date("2026-11-24T18:15:00Z"), "Asia/Kolkata"), { date: "2026-11-24", minutes: 23 * 60 + 45 });
    assert.equal(clinicNow(new Date("2026-11-24T18:45:00Z"), "UTC").date, "2026-11-24");
  });

  it("reads weekdays as 0 = Sunday … 6 = Saturday", () => {
    assert.equal(weekdayOf("2026-11-22"), 0);
    assert.equal(weekdayOf("2026-11-24"), 2);
    assert.equal(weekdayOf("2026-11-28"), 6);
  });

  it("accepts only real YYYY-MM-DD dates and adds days across months and years", () => {
    assert.ok(isIsoDate("2028-02-29"));
    for (const bad of ["2026-02-29", "2026-13-01", "2026-1-01", "2026-11-24T00:00", "", "20261124"]) assert.ok(!isIsoDate(bad), bad);
    assert.equal(addDays("2026-11-24", 90), "2027-02-22");
    assert.equal(addDays("2026-12-31", 1), "2027-01-01");
  });
});
