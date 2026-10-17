"use client";

const PENDING_KEY = "corvo_cr_pending";
const DONE_KEY = "corvo_cr_done";

/** Marks a just-completed signup so the next /app load can fire CompleteRegistration. */
export function markPendingCompleteRegistration(eventId: string): void {
  try {
    localStorage.setItem(PENDING_KEY, eventId);
  } catch {}
}

/** Peeks without mutating state, so callers can decide whether it's worth waiting for fbq. */
export function hasPendingCompleteRegistration(): boolean {
  try {
    if (localStorage.getItem(DONE_KEY)) return false;
    return localStorage.getItem(PENDING_KEY) !== null;
  } catch {
    return false;
  }
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
