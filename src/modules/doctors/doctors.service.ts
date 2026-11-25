import { pageInfo } from "../../common/schemas";
import { AppError } from "../../common/http";
import type { UserRole } from "../../models/enums";
import { clinicNow, weekdayOf } from "../../utils/clinic-time";
import { computeFreeSlots } from "./doctors.availability";
import type { DoctorPatch, DoctorsRepository } from "./doctors.repository";
import type { Availability, DoctorView, ScheduleBlock, WeeklySchedule } from "./doctors.types";
import type { ListDoctorsQuery } from "./doctors.validation";

export type DoctorsServiceDeps = {
  repo: DoctorsRepository;
  clock: () => Date;
  timeZone: string;
};

/* One message for "no such ID" and "hidden from you", so callers cannot probe for inactive doctors. */
const doctorNotFound = () => new AppError(404, "DOCTOR_NOT_FOUND", "Doctor not found");
const hhmm = (time: string) => time.slice(0, 5);

export function createDoctorsService({ repo, clock, timeZone }: DoctorsServiceDeps) {
  /* Inactive doctors are visible to admins only. */
  async function visibleDoctor(id: string, role: UserRole): Promise<DoctorView> {
    const doctor = await repo.findDoctor(id);
    if (!doctor || (!doctor.isActive && role !== "admin")) throw doctorNotFound();
    return doctor;
  }

  return {
    async list(query: ListDoctorsQuery) {
      const { rows, total } = await repo.listDoctors({
        specialization: query.specialization,
        sort: query.sort,
        order: query.order,
        limit: query.pageSize,
        offset: (query.page - 1) * query.pageSize,
      });
      return { doctors: rows, pagination: pageInfo(query, total) };
    },

    get: (id: string, role: UserRole) => visibleDoctor(id, role),

    async schedule(id: string, role: UserRole): Promise<WeeklySchedule> {
      await visibleDoctor(id, role);
      const rows = await repo.listSchedules(id);
      const days = new Map<number, ScheduleBlock[]>();
      for (const row of rows) {
        const blocks = days.get(row.dayOfWeek) ?? [];
        blocks.push({
          startTime: hhmm(row.startTime),
          endTime: hhmm(row.endTime),
          slotDurationMinutes: row.slotDurationMinutes,
        });
        days.set(row.dayOfWeek, blocks);
      }
      return {
        doctorId: id,
        timezone: timeZone,
        days: [...days.entries()].sort(([a], [b]) => a - b).map(([dayOfWeek, blocks]) => ({ dayOfWeek, blocks })),
      };
    },

    /* `date` was already checked against the clinic calendar by the route's validation. */
    async availability(id: string, date: string, role: UserRole): Promise<Availability> {
      const doctor = await visibleDoctor(id, role);
      const now = clinicNow(clock(), timeZone);
      const [blocks, onDayOff, booked] = await Promise.all([
        repo.listSchedules(id, weekdayOf(date)),
        repo.isOnDayOff(id, date),
        repo.listBooked(id, date),
      ]);
      const slots = computeFreeSlots({
        isActive: doctor.isActive,
        blocks,
        onDayOff,
        booked,
        date,
        today: now.date,
        nowMinutes: now.minutes,
      });
      return { doctorId: id, date, timezone: timeZone, slots };
    },

    async update(id: string, patch: DoctorPatch): Promise<DoctorView> {
      const doctor = await repo.updateDoctor(id, patch);
      if (!doctor) throw doctorNotFound();
      return doctor;
    },
  };
}

export type DoctorsService = ReturnType<typeof createDoctorsService>;
