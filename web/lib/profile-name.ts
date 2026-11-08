import type { Profile } from "@/lib/api";

/**
 * True when the person was never asked their name: it is empty, or it is only the part of the
 * e-mail before the "@" (what older accounts got). A real name that happens to match is rare enough
 * that asking once more is harmless.
 */
export function needsName(profile: Profile | null | undefined): boolean {
  if (!profile) return false;
  const name = profile.name.trim().toLowerCase();
  if (!name) return true;
  return name === profile.email.split("@")[0].trim().toLowerCase();
}
