import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  parseReason,
  parseScheduledAt,
  validateProfileBody,
} from "../../src/modules/patients/patient.validator.ts";
import { isUuid } from "../../src/utils/validation.ts";

describe("patient validators", () => {
  it("accepts a name and phone and rejects a short phone", () => {
    assert.deepEqual(validateProfileBody({ fullName: "  Asha Rao  ", phone: "+91 98765 43210" }), {
      ok: true,
      fullName: "Asha Rao",
      phone: "+91 98765 43210",
    });

    const rejected = validateProfileBody({ fullName: "Asha Rao", phone: "123" });
    assert.equal(rejected.ok, false);
    if (!rejected.ok) {
      assert.equal(rejected.code, "INVALID_PHONE");
    }
  });

  it("normalizes a zoned timestamp and rejects a blank time", () => {
    const parsed = parseScheduledAt({
      scheduledAt: "2026-10-26T11:00:00+05:30",
    });

    assert.deepEqual(parsed, {
      ok: true,
      scheduledAt: "2026-10-26T05:30:00.000Z",
    });

    const missing = parseScheduledAt({});
    assert.equal(missing.ok, false);
  });

  it("treats an empty reason as absent and rejects whitespace", () => {
    assert.deepEqual(parseReason({ reason: "" }), { ok: true, reason: null });
    assert.deepEqual(parseReason({}), { ok: true, reason: null });

    const blank = parseReason({ reason: "   " });
    assert.equal(blank.ok, false);
    if (!blank.ok) {
      assert.equal(blank.code, "INVALID_REASON");
    }
  });

  it("recognises appointment ids", () => {
    assert.equal(isUuid("3f1c2a40-6b7e-4d2a-9c11-0a1b2c3d4e5f"), true);
    assert.equal(isUuid("not-an-id"), false);
  });
});
