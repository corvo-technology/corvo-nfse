"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { imports } from "./api";
import type { ImportJob } from "./types";

const POLL_MS = 1500;
const MOVING = new Set<ImportJob["status"]>(["processing", "emitting"]);

/**
 * Follows one import. Reads it now, and again every 1.5 s while it is being read or emitted;
 * stops when it settles. `refresh()` reads once more (after an edit or an Emit) and resumes polling if needed.
 */
export function useImport(id: string | null) {
  const [job, setJob] = useState<ImportJob | null>(null);
  const [error, setError] = useState<unknown>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const generation = useRef(0);
  const again = useRef<() => void>(() => undefined);

  const read = useCallback(async (): Promise<ImportJob | null> => {
    if (!id) return null;
    const current = generation.current;
    try {
      const next = await imports.get(id);
      if (current !== generation.current) return null;
      setJob(next); setError(null);
      if (MOVING.has(next.status)) timer.current = setTimeout(() => again.current(), POLL_MS);
      return next;
    } catch (cause) {
      if (current === generation.current) setError(cause);
      return null;
    }
  }, [id]);

  useEffect(() => {
    again.current = () => void read();
  }, [read]);

  useEffect(() => {
    generation.current += 1;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loads the import on mount; state is only set after the request answers
    void read();
    return () => {
      generation.current += 1;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [read]);

  const refresh = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current);
    return read();
  }, [read]);

  return { job, error, refresh };
}
