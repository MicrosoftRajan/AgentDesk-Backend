import type { UserRole } from "../../types/auth.js";

export interface Profile {
  id: string;
  role: UserRole;
  fullName: string | null;
  phone: string | null;
}

export interface ProfileRow {
  id: string;
  role: UserRole;
  full_name: string | null;
  phone: string | null;
}

export function toProfile(row: ProfileRow): Profile {
  return {
    id: row.id,
    role: row.role,
    fullName: row.full_name,
    phone: row.phone,
  };
}
