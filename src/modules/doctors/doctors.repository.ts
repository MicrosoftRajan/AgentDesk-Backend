import { and, asc, count, desc, eq, gte, lte, notInArray, sql, type SQL } from "drizzle-orm";
import type { Database } from "../../config/database";
import { appointments, doctors, doctorSchedules, doctorUnavailability, profiles } from "../../models";
import type { DoctorView } from "./doctors.types";
import type { DoctorSort } from "./doctors.validation";

export type ListDoctorsFilter = {
  specialization?: string;
  sort: DoctorSort;
  order: "asc" | "desc";
  limit: number;
  offset: number;
};

export type DoctorPatch = Partial<{
  specialization: string;
  qualification: string;
  experienceYears: number;
  consultationFee: number;
  isActive: boolean;
}>;

export type ScheduleRow = { dayOfWeek: number; startTime: string; endTime: string; slotDurationMinutes: number };
export type BookedRow = { startTime: string; endTime: string };

export interface DoctorsRepository {
  /* Active doctors only. */
  listDoctors(filter: ListDoctorsFilter): Promise<{ rows: DoctorView[]; total: number }>;
  /* Includes inactive doctors; the service decides who may see them. */
  findDoctor(id: string): Promise<DoctorView | undefined>;
  /* Active weekly-hours blocks, optionally for one weekday. */
  listSchedules(doctorId: string, dayOfWeek?: number): Promise<ScheduleRow[]>;
  isOnDayOff(doctorId: string, date: string): Promise<boolean>;
  /* Appointments that still hold their time on that date. */
  listBooked(doctorId: string, date: string): Promise<BookedRow[]>;
  updateDoctor(id: string, patch: DoctorPatch): Promise<DoctorView | undefined>;
}

/* Statuses that free the slot again. Mirrors the partial unique index unique_active_doctor_slot. */
export const RELEASED_STATUSES = ["cancelled", "rescheduled"] as const;

type Db = Database["db"];

const doctorColumns = {
  id: doctors.id,
  fullName: profiles.fullName,
  specialization: doctors.specialization,
  qualification: doctors.qualification,
  experienceYears: doctors.experienceYears,
  consultationFee: doctors.consultationFee,
  isActive: doctors.isActive,
};

/* Fixed map from the allowed sort names to columns. */
const SORT_COLUMNS = {
  name: profiles.fullName,
  fee: doctors.consultationFee,
  experience: doctors.experienceYears,
} as const;

type DoctorRow = Omit<DoctorView, "consultationFee"> & { consultationFee: string };
const toView = (row: DoctorRow): DoctorView => ({ ...row, consultationFee: Number(row.consultationFee) });

export function createDrizzleDoctorsRepository(db: Db): DoctorsRepository {
  const findDoctor = async (id: string): Promise<DoctorView | undefined> => {
    const [row] = await db
      .select(doctorColumns)
      .from(doctors)
      .innerJoin(profiles, eq(profiles.id, doctors.profileId))
      .where(eq(doctors.id, id))
      .limit(1);
    return row ? toView(row) : undefined;
  };

  return {
    findDoctor,

    async listDoctors(filter) {
      const conditions: SQL[] = [eq(doctors.isActive, true)];
      if (filter.specialization) {
        conditions.push(sql`lower(${doctors.specialization}) = lower(${filter.specialization})`);
      }
      const where = and(...conditions);
      const direction = filter.order === "desc" ? desc : asc;

      const [rows, totals] = await Promise.all([
        db
          .select(doctorColumns)
          .from(doctors)
          .innerJoin(profiles, eq(profiles.id, doctors.profileId))
          .where(where)
          .orderBy(direction(SORT_COLUMNS[filter.sort]), asc(doctors.id))
          .limit(filter.limit)
          .offset(filter.offset),
        db.select({ total: count() }).from(doctors).where(where),
      ]);
      return { rows: rows.map(toView), total: totals[0]?.total ?? 0 };
    },

    async listSchedules(doctorId, dayOfWeek) {
      const conditions = [eq(doctorSchedules.doctorId, doctorId), eq(doctorSchedules.isActive, true)];
      if (dayOfWeek !== undefined) conditions.push(eq(doctorSchedules.dayOfWeek, dayOfWeek));
      return db
        .select({
          dayOfWeek: doctorSchedules.dayOfWeek,
          startTime: doctorSchedules.startTime,
          endTime: doctorSchedules.endTime,
          slotDurationMinutes: doctorSchedules.slotDurationMinutes,
        })
        .from(doctorSchedules)
        .where(and(...conditions))
        .orderBy(asc(doctorSchedules.dayOfWeek), asc(doctorSchedules.startTime));
    },

    async isOnDayOff(doctorId, date) {
      const [row] = await db
        .select({ id: doctorUnavailability.id })
        .from(doctorUnavailability)
        .where(
          and(
            eq(doctorUnavailability.doctorId, doctorId),
            lte(doctorUnavailability.startDate, date),
            gte(doctorUnavailability.endDate, date),
          ),
        )
        .limit(1);
      return row !== undefined;
    },

    async listBooked(doctorId, date) {
      return db
        .select({ startTime: appointments.startTime, endTime: appointments.endTime })
        .from(appointments)
        .where(
          and(
            eq(appointments.doctorId, doctorId),
            eq(appointments.appointmentDate, date),
            notInArray(appointments.status, [...RELEASED_STATUSES]),
          ),
        );
    },

    async updateDoctor(id, patch) {
      const { consultationFee, ...rest } = patch;
      const values = {
        ...rest,
        ...(consultationFee === undefined ? {} : { consultationFee: consultationFee.toFixed(2) }),
      };
      const [updated] = await db.update(doctors).set(values).where(eq(doctors.id, id)).returning({ id: doctors.id });
      return updated ? findDoctor(updated.id) : undefined;
    },
  };
}
