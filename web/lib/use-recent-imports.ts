"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { imports } from "./api";
import type { ImportJob } from "./types";

export type RecentImportsState = {
  status: "loading" | "ready" | "error";
  items: ImportJob[];
  reload: () => void;
};

/** The newest imports of the current environment, read once so the banner and the list share it. */
export function useRecentImports(limit = 10, enabled = true): RecentImportsState {
  const [items, setItems] = useState<ImportJob[]>([]);
  const [status, setStatus] = useState<RecentImportsState["status"]>("loading");
  const [attempt, setAttempt] = useState(0);
  const generation = useRef(0);

  useEffect(() => {
    if (!enabled) return;
    const current = ++generation.current;
    const abort = new AbortController();
    imports.list(limit, abort.signal)
      .then((list) => { if (current === generation.current) { setItems(list); setStatus("ready"); } })
      .catch((cause) => { if (current === generation.current && !(cause instanceof Error && cause.name === "AbortError")) setStatus("error"); });
    return () => abort.abort();
  }, [limit, enabled, attempt]);

  const reload = useCallback(() => { setStatus("loading"); setAttempt((n) => n + 1); }, []);
  return { status, items, reload };
}
