"use client";

import { revokeConsent } from "@/lib/consent";

/** The only interactive part of the footer, so the rest of it can render on the server. */
export function CookiePreferencesButton({ label }: { label: string }) {
  return (
    <button
      type="button"
      onClick={() => revokeConsent()}
      className="hover:text-text-2 transition-colors cursor-pointer"
    >
      {label}
    </button>
  );
}
