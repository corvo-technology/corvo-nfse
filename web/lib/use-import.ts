"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { imports } from "./api";
import type { ImportJob } from "./types";

const POLL_MS = 1500;
/** Longest wait between two tries while the server does not answer. */
const RETRY_MAX_MS = 15_000;
const MOVING = new Set<ImportJob["status"]>(["processing", "emitting"]);

/** The numbers that move while an import runs; a change in any of them is news. */
const progressKey = (job: ImportJob) => `${job.status}|${JSON.stringify(job.counters)}`;

/**
 * Follows one import. Reads it now, and again every 1.5 s while it is being read or emitted;
 * stops when it settles. `refresh()` reads once more (after an edit or an Emit) and resumes polling if needed.
 *
 * A read that fails while the import is moving does not stop the follow-up: the last known import stays on
 * screen, `reconnecting` turns on and it tries again, waiting a little longer each time. Only a failure before
 * the first answer is reported as `error`. Coming back to the tab reads again right away.
 */
export function useImport(id: string | null) {
  const [job, setJob] = useState<ImportJob | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [reconnecting, setReconnecting] = useState(false);
  /** When the last successful read answered (ms). */
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  /** When the counters or the status last changed (ms): what tells a slow import from a stuck screen. */
  const [changedAt, setChangedAt] = useState<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const generation = useRef(0);
  const again = useRef<() => void>(() => undefined);
  const last = useRef<{ job: ImportJob; key: string } | null>(null);
  const failures = useRef(0);

  const schedule = useCallback((ms: number) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => again.current(), ms);
  }, []);

  const read = useCallback(async (): Promise<ImportJob | null> => {
    if (!id) return null;
    const current = generation.current;
    try {
      const next = await imports.get(id);
      if (current !== generation.current) return null;
      const now = Date.now();
      const key = progressKey(next);
      if (last.current?.key !== key) setChangedAt(now);
      last.current = { job: next, key };
      failures.current = 0;
      setJob(next); setError(null); setReconnecting(false); setUpdatedAt(now);
      if (MOVING.has(next.status)) schedule(POLL_MS);
      return next;
    } catch (cause) {
      if (current !== generation.current) return null;
      if (last.current && MOVING.has(last.current.job.status)) {
        failures.current += 1;
        setReconnecting(true);
        schedule(Math.min(POLL_MS * 2 ** failures.current, RETRY_MAX_MS));
        return null;
      }
      setError(cause);
      return null;
    }
  }, [id, schedule]);

  useEffect(() => {
    again.current = () => void read();
  }, [read]);

  useEffect(() => {
    generation.current += 1;
    last.current = null;
    failures.current = 0;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loads the import on mount; state is only set after the request answers
    void read();
    return () => {
      generation.current += 1;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [read]);

  // A hidden tab may hold the timers back; coming back should show the latest numbers at once.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      if (!last.current || !MOVING.has(last.current.job.status)) return;
      if (timer.current) clearTimeout(timer.current);
      void read();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [read]);

  const refresh = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current);
    return read();
  }, [read]);

  return { job, error, refresh, reconnecting, updatedAt, changedAt };
}
