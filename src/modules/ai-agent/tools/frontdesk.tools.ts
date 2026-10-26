import { DATE_PATTERN, istDayBounds } from "../../appointments/clinicSchedule.js";
import {
  DatabaseError,
  cancelScheduledAppointment,
  getAppointment,
  insertStaffAppointment,
  isUniqueViolation,
  markScheduledNoShow,
  recordReminderSent,
  rescheduleScheduledAppointment,
  searchAppointments,
} from "../../appointments/appointment.repository.js";
import {
  isAppointmentStatus,
  type AppointmentStatus,
} from "../../appointments/appointment.types.js";
import { PHONE_PATTERN } from "../../../utils/validation.js";

import {
  asObject,
  fail,
  ok,
  optionalString,
  requiredFutureDate,
  requiredId,
  requiredString,
} from "./toolInput.js";

import type { AgentTool, ToolResult } from "./tool.types.js";

const SLOT_TAKEN_MESSAGE =
  "That time slot is already booked. Ask for or suggest another time.";

const MAX_LIST_RESULTS = 50;

function rethrowDatabaseError(error: unknown, prefix: string): never {
  if (isUniqueViolation(error)) {
    throw new Error(SLOT_TAKEN_MESSAGE);
  }

  if (error instanceof DatabaseError) {
    throw new Error(`${prefix}: ${error.message}`);
  }

  throw error;
}

/* ------------------------------------------------------------------ */
/* Low risk: runs without approval                                    */
/* ------------------------------------------------------------------ */

export const listAppointmentsTool: AgentTool = {
  name: "list_appointments",
  description:
    "Lists appointments, optionally for one day and/or one status. " +
    "Use this to find an appointment id before rescheduling, cancelling " +
    "or sending a reminder. Returns at most 50, soonest first.",
  riskLevel: "low",
  parameters: {
    type: "object",
    properties: {
      date: {
        type: "string",
        description:
          "Optional day in YYYY-MM-DD (clinic local time, IST).",
      },
      status: {
        type: "string",
        description:
          "Optional: scheduled, cancelled, completed or no_show.",
      },
      patient_name: {
        type: "string",
        description: "Optional case-insensitive name search.",
      },
    },
    required: [],
  },

  async execute(input): Promise<ToolResult> {
    try {
      const value = asObject(input ?? {}, "list_appointments");
      const date = optionalString(value, "date", 10);
      let startIso: string | undefined;
      let endIso: string | undefined;

      if (date) {
        if (!DATE_PATTERN.test(date)) {
          throw new Error("date must be YYYY-MM-DD");
        }

        const bounds = istDayBounds(date);

        if (!bounds) {
          throw new Error("date is not a valid day");
        }

        startIso = bounds.start.toISOString();
        endIso = bounds.end.toISOString();
      }

      const status = optionalString(value, "status", 20);

      if (status && !isAppointmentStatus(status)) {
        throw new Error(
          "status must be scheduled, cancelled, completed or no_show",
        );
      }

      const name = optionalString(value, "patient_name", 100);
      const filter: {
        limit: number;
        startIso?: string;
        endIso?: string;
        status?: AppointmentStatus;
        patientNameIlike?: string;
      } = { limit: MAX_LIST_RESULTS };

      if (startIso !== undefined && endIso !== undefined) {
        filter.startIso = startIso;
        filter.endIso = endIso;
      }

      if (status && isAppointmentStatus(status)) {
        filter.status = status;
      }

      if (name) {
        filter.patientNameIlike = `%${name.replace(/[%_]/g, "")}%`;
      }

      let appointments;

      try {
        appointments = await searchAppointments(filter);
      } catch (error) {
        rethrowDatabaseError(error, "Could not list appointments");
      }

      return ok({ count: appointments.length, appointments });
    } catch (error) {
      return fail(error, "list_appointments failed");
    }
  },
};

export const bookAppointmentTool: AgentTool = {
  name: "book_appointment",
  description:
    "Books a new appointment. Fails if the slot is already taken.",
  riskLevel: "low",
  parameters: {
    type: "object",
    properties: {
      patient_name: {
        type: "string",
        description: "Patient's full name.",
      },
      patient_phone: {
        type: "string",
        description: "Patient's phone number, e.g. +919876543210.",
      },
      scheduled_at: {
        type: "string",
        description:
          "ISO 8601 date-time WITH timezone offset, e.g. 2026-10-08T15:30:00+05:30.",
      },
      reason: {
        type: "string",
        description:
          "Optional short, non-clinical reason, e.g. 'follow-up visit'.",
      },
    },
    required: ["patient_name", "patient_phone", "scheduled_at"],
  },

  async execute(input): Promise<ToolResult> {
    try {
      const value = asObject(input, "book_appointment");

      const patientName = requiredString(value, "patient_name", 100);
      const patientPhone = requiredString(value, "patient_phone", 20);

      if (!PHONE_PATTERN.test(patientPhone)) {
        throw new Error("patient_phone does not look like a phone number");
      }

      const scheduledAt = requiredFutureDate(value, "scheduled_at");
      const reason = optionalString(value, "reason", 200);

      try {
        const appointment = await insertStaffAppointment({
          patientName,
          patientPhone,
          scheduledAt,
          reason,
        });

        return ok({ appointment });
      } catch (error) {
        rethrowDatabaseError(error, "Could not book appointment");
      }
    } catch (error) {
      return fail(error, "book_appointment failed");
    }
  },
};

export const rescheduleAppointmentTool: AgentTool = {
  name: "reschedule_appointment",
  description:
    "Moves a scheduled appointment to a new time. Fails if the new slot " +
    "is taken or the appointment is not currently scheduled.",
  riskLevel: "low",
  parameters: {
    type: "object",
    properties: {
      appointment_id: {
        type: "string",
        description: "Appointment id from list_appointments.",
      },
      new_scheduled_at: {
        type: "string",
        description:
          "ISO 8601 date-time WITH timezone offset, e.g. 2026-10-09T11:00:00+05:30.",
      },
    },
    required: ["appointment_id", "new_scheduled_at"],
  },

  async execute(input): Promise<ToolResult> {
    try {
      const value = asObject(input, "reschedule_appointment");

      const id = requiredId(value);
      const scheduledAt = requiredFutureDate(value, "new_scheduled_at");

      const existing = await getAppointment(id);

      if (existing.status !== "scheduled") {
        throw new Error(
          `Only scheduled appointments can be moved (this one is ${existing.status}).`,
        );
      }

      try {
        const appointment = await rescheduleScheduledAppointment(
          id,
          scheduledAt,
        );

        if (!appointment) {
          throw new Error(
            "Appointment changed while rescheduling; try again.",
          );
        }

        return ok({
          previousTime: existing.scheduledAt,
          appointment,
        });
      } catch (error) {
        rethrowDatabaseError(error, "Could not reschedule appointment");
      }
    } catch (error) {
      return fail(error, "reschedule_appointment failed");
    }
  },
};

export const markNoShowTool: AgentTool = {
  name: "mark_no_show",
  description:
    "Marks a scheduled appointment whose time has already passed as a " +
    "no-show, so it can be followed up.",
  riskLevel: "low",
  parameters: {
    type: "object",
    properties: {
      appointment_id: {
        type: "string",
        description: "Appointment id from list_appointments.",
      },
    },
    required: ["appointment_id"],
  },

  async execute(input): Promise<ToolResult> {
    try {
      const value = asObject(input, "mark_no_show");
      const id = requiredId(value);

      const existing = await getAppointment(id);

      if (existing.status !== "scheduled") {
        throw new Error(
          `Only scheduled appointments can be marked no-show (this one is ${existing.status}).`,
        );
      }

      if (Date.parse(existing.scheduledAt) > Date.now()) {
        throw new Error(
          "This appointment is still in the future, so it can't be a no-show.",
        );
      }

      try {
        const appointment = await markScheduledNoShow(id);

        if (!appointment) {
          throw new Error("Appointment changed meanwhile; try again.");
        }

        return ok({ appointment });
      } catch (error) {
        rethrowDatabaseError(error, "Could not update appointment");
      }
    } catch (error) {
      return fail(error, "mark_no_show failed");
    }
  },
};

export const sendReminderTool: AgentTool = {
  name: "send_reminder",
  description:
    "Sends the patient a reminder (or, for a no-show, a follow-up) about " +
    "their appointment.",
  riskLevel: "low",
  parameters: {
    type: "object",
    properties: {
      appointment_id: {
        type: "string",
        description: "Appointment id from list_appointments.",
      },
    },
    required: ["appointment_id"],
  },

  /**
   * SIMULATED: no WhatsApp/SMS provider is connected yet. It builds the
   * message and records last_reminder_at, but nothing is delivered.
   * Swap the marked block for a real provider call later.
   */
  async execute(input): Promise<ToolResult> {
    try {
      const value = asObject(input, "send_reminder");
      const id = requiredId(value);

      const appointment = await getAppointment(id);

      if (
        appointment.status !== "scheduled" &&
        appointment.status !== "no_show"
      ) {
        throw new Error(
          `Reminders are only sent for scheduled or no-show appointments (this one is ${appointment.status}).`,
        );
      }

      const when = new Date(appointment.scheduledAt).toLocaleString(
        "en-IN",
        {
          timeZone: "Asia/Kolkata",
          dateStyle: "medium",
          timeStyle: "short",
        },
      );

      const message =
        appointment.status === "no_show"
          ? `Hello ${appointment.patientName}, we missed you at your appointment on ${when}. Reply to this message to book a new time.`
          : `Hello ${appointment.patientName}, this is a reminder for your appointment on ${when}. Reply to reschedule.`;

      // --- Replace with a real WhatsApp/SMS provider call. ---
      await recordReminderSent(id);

      return ok({
        to: appointment.patientPhone,
        message,
        delivered: false,
        simulated: true,
        note:
          "Demo: no messaging provider is connected, so nothing was actually sent.",
      });
    } catch (error) {
      return fail(error, "send_reminder failed");
    }
  },
};

/* ------------------------------------------------------------------ */
/* High risk: always paused for manager approval                      */
/* ------------------------------------------------------------------ */

export const cancelAppointmentTool: AgentTool = {
  name: "cancel_appointment",
  description:
    "Cancels a scheduled appointment. Requires manager approval before " +
    "it runs. Prefer rescheduling if the patient only wants a new time.",
  riskLevel: "high",
  parameters: {
    type: "object",
    properties: {
      appointment_id: {
        type: "string",
        description: "Appointment id from list_appointments.",
      },
      reason: {
        type: "string",
        description: "Short reason for the cancellation.",
      },
    },
    required: ["appointment_id", "reason"],
  },

  async execute(input): Promise<ToolResult> {
    try {
      const value = asObject(input, "cancel_appointment");

      const id = requiredId(value);
      const reason = requiredString(value, "reason", 200);

      const existing = await getAppointment(id);

      if (existing.status !== "scheduled") {
        throw new Error(
          `Only scheduled appointments can be cancelled (this one is ${existing.status}).`,
        );
      }

      try {
        const appointment = await cancelScheduledAppointment(id, reason);

        if (!appointment) {
          throw new Error("Appointment changed meanwhile; try again.");
        }

        return ok({ appointment });
      } catch (error) {
        rethrowDatabaseError(error, "Could not cancel appointment");
      }
    } catch (error) {
      return fail(error, "cancel_appointment failed");
    }
  },
};

export const issueRefundTool: AgentTool = {
  name: "issue_refund",
  description:
    "Issues a refund for an appointment fee. Requires manager approval " +
    "before it runs.",
  riskLevel: "high",
  parameters: {
    type: "object",
    properties: {
      appointment_id: {
        type: "string",
        description: "Appointment id the refund is for.",
      },
      amount_inr: {
        type: "number",
        description: "Refund amount in rupees.",
      },
      reason: {
        type: "string",
        description: "Short reason for the refund.",
      },
    },
    required: ["appointment_id", "amount_inr", "reason"],
  },

  /**
   * SIMULATED: no payment gateway is connected. Validates the request and
   * confirms the appointment exists, but moves no money. Replace the body
   * with a real gateway call; riskLevel keeps it behind approval.
   */
  async execute(input): Promise<ToolResult> {
    try {
      const value = asObject(input, "issue_refund");

      const id = requiredId(value);
      const reason = requiredString(value, "reason", 200);

      const amount = value.amount_inr;

      if (
        typeof amount !== "number" ||
        !Number.isFinite(amount) ||
        amount <= 0 ||
        amount > 100_000
      ) {
        throw new Error(
          "amount_inr must be a positive number up to 100000",
        );
      }

      const appointment = await getAppointment(id);

      return ok({
        appointmentId: appointment.id,
        patientName: appointment.patientName,
        amountInr: amount,
        reason,
        refunded: false,
        simulated: true,
        note:
          "Demo: no payment gateway is connected, so no money was actually refunded.",
      });
    } catch (error) {
      return fail(error, "issue_refund failed");
    }
  },
};

export const frontDeskTools: AgentTool[] = [
  listAppointmentsTool,
  bookAppointmentTool,
  rescheduleAppointmentTool,
  markNoShowTool,
  sendReminderTool,
  cancelAppointmentTool,
  issueRefundTool,
];
