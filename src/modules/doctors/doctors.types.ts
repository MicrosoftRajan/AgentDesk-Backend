/* What the doctors API returns. These shapes never include phone numbers, emails,
profile or user IDs, or timestamps. */

export type DoctorView = {
  id: string;
  fullName: string;
  specialization: string;
  qualification: string;
  experienceYears: number;
  consultationFee: number;
  isActive: boolean;
};

export type ScheduleBlock = { startTime: string; endTime: string; slotDurationMinutes: number };

export type WeeklySchedule = {
  doctorId: string;
  timezone: string;
  days: { dayOfWeek: number; blocks: ScheduleBlock[] }[];
};

export type Slot = { startTime: string; endTime: string };

export type Availability = { doctorId: string; date: string; timezone: string; slots: Slot[] };
