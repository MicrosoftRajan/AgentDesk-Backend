import { supabase } from "../../config/supabase.js";

import {
  toProfile,
  type Profile,
  type ProfileRow,
} from "./profile.types.js";

const PROFILE_COLUMNS = "id, role, full_name, phone";

export class ProfileDatabaseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProfileDatabaseError";
  }
}

export async function findProfile(userId: string): Promise<Profile | null> {
  const { data, error } = await supabase
    .from("profiles")
    .select(PROFILE_COLUMNS)
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    throw new ProfileDatabaseError(
      `Could not load profile: ${error.message}`,
    );
  }

  return data ? toProfile(data as unknown as ProfileRow) : null;
}

export async function insertPatientProfile(userId: string): Promise<void> {
  const { error } = await supabase
    .from("profiles")
    .upsert(
      { id: userId, role: "patient" },
      // If a concurrent request created the row first, leave it alone.
      { onConflict: "id", ignoreDuplicates: true },
    );

  if (error) {
    throw new ProfileDatabaseError(
      `Could not create profile: ${error.message}`,
    );
  }
}

export async function updateProfileContact(
  userId: string,
  details: { fullName: string; phone: string },
): Promise<Profile> {
  const { data, error } = await supabase
    .from("profiles")
    .update({
      full_name: details.fullName,
      phone: details.phone,
      updated_at: new Date().toISOString(),
    })
    .eq("id", userId)
    .select(PROFILE_COLUMNS)
    .single();

  if (error) {
    throw new ProfileDatabaseError(
      `Could not update profile: ${error.message}`,
    );
  }

  return toProfile(data as unknown as ProfileRow);
}
