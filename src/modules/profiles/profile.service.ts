import {
  findProfile,
  insertPatientProfile,
  updateProfileContact,
} from "./profile.repository.js";
import type { Profile } from "./profile.types.js";

/**
 * Loads the user's profile. Anyone without one yet (a brand-new sign-up)
 * becomes a `patient`. Staff are only ever created by an admin, so a
 * missing row can never grant elevated access.
 */
export async function getOrCreateProfile(userId: string): Promise<Profile> {
  const existing = await findProfile(userId);

  if (existing) {
    return existing;
  }

  await insertPatientProfile(userId);

  const created = await findProfile(userId);

  if (!created) {
    throw new Error("Profile was not created");
  }

  return created;
}

export async function updateProfileDetails(
  userId: string,
  details: { fullName: string; phone: string },
): Promise<Profile> {
  // Make sure the row exists, then update ONLY contact fields. The role
  // column is deliberately not writable from here.
  await getOrCreateProfile(userId);

  return updateProfileContact(userId, details);
}
