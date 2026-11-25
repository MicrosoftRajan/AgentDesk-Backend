import type { AppointmentStatus } from "../../src/models/enums";
import {
  RELEASED_STATUSES,
  type BookedRow,
  type DoctorPatch,
  type DoctorsRepository,
  type ListDoctorsFilter,
  type ScheduleRow,
} from "../../src/modules/doctors/doctors.repository";
import type { DoctorView } from "../../src/modules/doctors/doctors.types";

type ScheduleFake = ScheduleRow & { doctorId: string; isActive: boolean };
type DayOffFake = { doctorId: string; startDate: string; endDate: string };
type AppointmentFake = BookedRow & { doctorId: string; date: string; status: AppointmentStatus };

export class FakeDoctorsRepository implements DoctorsRepository {
  readonly doctors = new Map<string, DoctorView>();
  readonly schedules: ScheduleFake[] = [];
  readonly daysOff: DayOffFake[] = [];
  readonly appointments: AppointmentFake[] = [];

  addDoctor(doctor: DoctorView) {
    this.doctors.set(doctor.id, { ...doctor });
  }

  async listDoctors(filter: ListDoctorsFilter) {
    const key = { name: "fullName", fee: "consultationFee", experience: "experienceYears" } as const;
    const field = key[filter.sort];
    const sign = filter.order === "desc" ? -1 : 1;
    const matching = [...this.doctors.values()]
      .filter((d) => d.isActive)
      .filter((d) => !filter.specialization || d.specialization.toLowerCase() === filter.specialization.toLowerCase())
      .sort((a, b) => {
        const x = a[field];
        const y = b[field];
        if (x !== y) return (x < y ? -1 : 1) * sign;
        return a.id < b.id ? -1 : 1;
      });
    return {
      rows: matching.slice(filter.offset, filter.offset + filter.limit).map((d) => ({ ...d })),
      total: matching.length,
    };
  }

  async findDoctor(id: string) {
    const doctor = this.doctors.get(id);
    return doctor ? { ...doctor } : undefined;
  }

  async listSchedules(doctorId: string, dayOfWeek?: number) {
    return this.schedules
      .filter((s) => s.doctorId === doctorId && s.isActive && (dayOfWeek === undefined || s.dayOfWeek === dayOfWeek))
      .sort((a, b) => a.dayOfWeek - b.dayOfWeek || a.startTime.localeCompare(b.startTime))
      .map(({ dayOfWeek: d, startTime, endTime, slotDurationMinutes }) => ({ dayOfWeek: d, startTime, endTime, slotDurationMinutes }));
  }

  async isOnDayOff(doctorId: string, date: string) {
    return this.daysOff.some((d) => d.doctorId === doctorId && d.startDate <= date && date <= d.endDate);
  }

  async listBooked(doctorId: string, date: string) {
    return this.appointments
      .filter(
        (a) =>
          a.doctorId === doctorId &&
          a.date === date &&
          !(RELEASED_STATUSES as readonly string[]).includes(a.status),
      )
      .map(({ startTime, endTime }) => ({ startTime, endTime }));
  }

  async updateDoctor(id: string, patch: DoctorPatch) {
    const doctor = this.doctors.get(id);
    if (!doctor) return undefined;
    Object.assign(doctor, patch);
    return { ...doctor };
  }
}
