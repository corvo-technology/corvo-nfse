"use client";

const PENDING_KEY = "corvo_cr_pending";
const DONE_KEY = "corvo_cr_done";

/** Marks a just-completed signup so the next /app load can fire CompleteRegistration. */
export function markPendingCompleteRegistration(eventId: string): void {
  try {
    localStorage.setItem(PENDING_KEY, eventId);
  } catch {}
}

/** Consumes the pending flag at most once; returns the event id to fire, or null. */
export function consumePendingCompleteRegistration(): string | null {
  try {
    if (localStorage.getItem(DONE_KEY)) return null;
    const eventId = localStorage.getItem(PENDING_KEY);
    if (!eventId) return null;
    localStorage.setItem(DONE_KEY, "1");
    localStorage.removeItem(PENDING_KEY);
    return eventId;
  } catch {
    return null;
  }
}

export function clearCompleteRegistrationFlags(): void {
  try {
    localStorage.removeItem(PENDING_KEY);
    localStorage.removeItem(DONE_KEY);
  } catch {}
}
