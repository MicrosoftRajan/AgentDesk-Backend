import { relations } from "drizzle-orm";
import { actionHistory } from "./action-history";
import { aiActions } from "./ai-actions";
import { appointments } from "./appointments";
import { doctorSchedules } from "./doctor-schedules";
import { doctorUnavailability } from "./doctor-unavailability";
import { doctors } from "./doctors";
import { emailVerificationTokens } from "./email-verification-tokens";
import { notifications } from "./notifications";
import { passwordResetTokens } from "./password-reset-tokens";
import { patients } from "./patients";
import { profiles } from "./profiles";
import { refreshTokens } from "./refresh-tokens";
import { users } from "./users";

export const usersRelations = relations(users, ({ one, many }) => ({
  profile: one(profiles),
  refreshTokens: many(refreshTokens),
  passwordResetTokens: many(passwordResetTokens),
  emailVerificationTokens: many(emailVerificationTokens),
}));

export const refreshTokensRelations = relations(refreshTokens, ({ one }) => ({
  user: one(users, { fields: [refreshTokens.userId], references: [users.id] }),
  replacedBy: one(refreshTokens, { fields: [refreshTokens.replacedById], references: [refreshTokens.id] }),
}));

export const passwordResetTokensRelations = relations(passwordResetTokens, ({ one }) => ({
  user: one(users, { fields: [passwordResetTokens.userId], references: [users.id] }),
}));

export const emailVerificationTokensRelations = relations(emailVerificationTokens, ({ one }) => ({
  user: one(users, { fields: [emailVerificationTokens.userId], references: [users.id] }),
}));

export const profilesRelations = relations(profiles, ({ one, many }) => ({
  user: one(users, { fields: [profiles.id], references: [users.id] }),
  doctor: one(doctors),
  patient: one(patients),
  bookedAppointments: many(appointments),
  requestedAiActions: many(aiActions),
  performedHistory: many(actionHistory, { relationName: "history_performed_by" }),
  approvedHistory: many(actionHistory, { relationName: "history_approved_by" }),
  notifications: many(notifications),
}));

export const doctorsRelations = relations(doctors, ({ one, many }) => ({
  profile: one(profiles, { fields: [doctors.profileId], references: [profiles.id] }),
  schedules: many(doctorSchedules),
  unavailability: many(doctorUnavailability),
  appointments: many(appointments),
  aiActions: many(aiActions),
}));

export const doctorSchedulesRelations = relations(doctorSchedules, ({ one }) => ({
  doctor: one(doctors, { fields: [doctorSchedules.doctorId], references: [doctors.id] }),
}));

export const doctorUnavailabilityRelations = relations(doctorUnavailability, ({ one }) => ({
  doctor: one(doctors, { fields: [doctorUnavailability.doctorId], references: [doctors.id] }),
}));

export const patientsRelations = relations(patients, ({ one, many }) => ({
  profile: one(profiles, { fields: [patients.profileId], references: [profiles.id] }),
  appointments: many(appointments),
  aiActions: many(aiActions),
}));

export const appointmentsRelations = relations(appointments, ({ one, many }) => ({
  patient: one(patients, { fields: [appointments.patientId], references: [patients.id] }),
  doctor: one(doctors, { fields: [appointments.doctorId], references: [doctors.id] }),
  bookedBy: one(profiles, { fields: [appointments.bookedBy], references: [profiles.id] }),

  rescheduledFrom: one(appointments, {
    fields: [appointments.rescheduledFrom],
    references: [appointments.id],
  }),
  aiActions: many(aiActions),
  history: many(actionHistory),
  notifications: many(notifications),
}));

export const aiActionsRelations = relations(aiActions, ({ one, many }) => ({
  requestedBy: one(profiles, { fields: [aiActions.requestedBy], references: [profiles.id] }),
  doctor: one(doctors, { fields: [aiActions.doctorId], references: [doctors.id] }),
  relatedPatient: one(patients, { fields: [aiActions.relatedPatientId], references: [patients.id] }),
  relatedAppointment: one(appointments, {
    fields: [aiActions.relatedAppointmentId],
    references: [appointments.id],
  }),
  history: one(actionHistory),
  notifications: many(notifications),
}));

export const actionHistoryRelations = relations(actionHistory, ({ one }) => ({
  aiAction: one(aiActions, { fields: [actionHistory.aiActionId], references: [aiActions.id] }),
  performedBy: one(profiles, {
    fields: [actionHistory.performedBy],
    references: [profiles.id],
    relationName: "history_performed_by",
  }),
  approvedBy: one(profiles, {
    fields: [actionHistory.approvedBy],
    references: [profiles.id],
    relationName: "history_approved_by",
  }),
  appointment: one(appointments, {
    fields: [actionHistory.appointmentId],
    references: [appointments.id],
  }),
}));

export const notificationsRelations = relations(notifications, ({ one }) => ({
  user: one(profiles, { fields: [notifications.userId], references: [profiles.id] }),
  relatedAppointment: one(appointments, {
    fields: [notifications.relatedAppointmentId],
    references: [appointments.id],
  }),
  relatedAiAction: one(aiActions, {
    fields: [notifications.relatedAiActionId],
    references: [aiActions.id],
  }),
}));
