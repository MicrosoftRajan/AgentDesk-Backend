import { pgEnum } from "drizzle-orm/pg-core";

export const userRole = pgEnum("user_role", ["admin", "receptionist", "doctor", "patient"]);

export const gender = pgEnum("gender", ["male", "female", "other"]);

export const appointmentStatus = pgEnum("appointment_status", [
  "scheduled",
  "completed",
  "cancelled",
  "no_show",
  "rescheduled",
]);

export const actionType = pgEnum("action_type", ["book", "reschedule", "cancel"]);

export const actionStatus = pgEnum("action_status", ["pending", "approved", "rejected", "expired"]);

export const notificationType = pgEnum("notification_type", [
  "booked",
  "rescheduled",
  "cancelled",
  "reminder",
  "action_pending",
]);

export type UserRole = (typeof userRole.enumValues)[number];
export type Gender = (typeof gender.enumValues)[number];
export type AppointmentStatus = (typeof appointmentStatus.enumValues)[number];
export type ActionType = (typeof actionType.enumValues)[number];
export type ActionStatus = (typeof actionStatus.enumValues)[number];
export type NotificationType = (typeof notificationType.enumValues)[number];
