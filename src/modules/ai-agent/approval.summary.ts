import { getAppointment } from "../appointments/appointment.repository.js";

import type {
  ApprovalRequest,
  ApprovalSummary,
} from "./agent.types.js";

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

/**
 * Builds a plain-language description of what an approval will do, so the
 * manager sees "Ravi Kumar, Thu 9 Oct, 4:00 pm" instead of a raw id.
 *
 * Best effort: any failure returns null and the client falls back to the
 * raw tool input. It never throws and never changes what will run.
 */
export async function summarizeApproval(
  approval: ApprovalRequest,
): Promise<ApprovalSummary | null> {
  try {
    const input = asRecord(approval.toolInput);

    if (
      approval.toolName !== "cancel_appointment" &&
      approval.toolName !== "issue_refund"
    ) {
      return null;
    }

    const id = input.appointment_id;

    if (typeof id !== "string") {
      return null;
    }

    const appointment = await getAppointment(id);

    const lines: ApprovalSummary["lines"] = [
      { label: "Patient", value: appointment.patientName },
      { label: "Phone", value: appointment.patientPhone },
      { label: "Appointment", value: formatWhen(appointment.scheduledAt) },
    ];

    if (approval.toolName === "issue_refund") {
      const amount = input.amount_inr;

      if (typeof amount === "number") {
        lines.push({ label: "Refund", value: `₹${amount}` });
      }
    }

    if (typeof input.reason === "string" && input.reason.trim()) {
      lines.push({ label: "Reason", value: input.reason.trim() });
    }

    return {
      title:
        approval.toolName === "cancel_appointment"
          ? "Cancel appointment"
          : "Issue refund",
      lines,
    };
  } catch {
    return null;
  }
}
