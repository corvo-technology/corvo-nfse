"use client";

const PENDING_KEY = "corvo_cr_pending";

/** Marks a just-completed signup so the next /app load can fire CompleteRegistration. */
export function markPendingCompleteRegistration(eventId: string): void {
  try {
    localStorage.setItem(PENDING_KEY, eventId);
  } catch {}
}

/** Peeks without mutating state, so callers can decide whether it's worth waiting for fbq. */
export function hasPendingCompleteRegistration(): boolean {
  try {
    return localStorage.getItem(PENDING_KEY) !== null;
  } catch {
    return false;
  }
}

/** Reads and removes the pending flag; returns the event id to fire, or null. */
export function consumePendingCompleteRegistration(): string | null {
  try {
    const eventId = localStorage.getItem(PENDING_KEY);
    if (!eventId) return null;
    localStorage.removeItem(PENDING_KEY);
    return eventId;
  } catch {
    return null;
  }
}

export function clearCompleteRegistrationFlags(): void {
  try {
    localStorage.removeItem(PENDING_KEY);
  } catch {}
}
