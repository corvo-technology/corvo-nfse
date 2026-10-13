"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Page } from "./api";

/** Cursor-paginated list: loads page one on mount/dep change, appends on loadMore(). */
export function useCursorPagination<T>(fetchPage: (cursor?: string, signal?: AbortSignal) => Promise<Page<T>>, deps: readonly unknown[]) {
  const [items, setItems] = useState<T[] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const fetcher = useRef(fetchPage);
  const generation = useRef(0);
  useEffect(() => { fetcher.current = fetchPage; });
  const reload = useCallback(() => {
    const current = ++generation.current;
    const abort = new AbortController();
    setItems(null); setError(null); setNextCursor(null); setHasMore(false);
    fetcher.current(undefined, abort.signal)
      .then((page) => { if (current !== generation.current) return; setItems(page.items); setNextCursor(page.nextCursor); setHasMore(page.hasMore); })
      .catch((cause) => { if (current === generation.current && !(cause instanceof Error && cause.name === "AbortError")) setError(cause); });
    return () => abort.abort();
  }, []);
  // eslint-disable-next-line react-hooks/exhaustive-deps, react-hooks/set-state-in-effect
  useEffect(() => reload(), [reload, ...deps]);
  const loadMore = useCallback(async () => {
    if (!nextCursor || loadingMore) return;
    const current = generation.current;
    setLoadingMore(true);
    try {
      const page = await fetcher.current(nextCursor);
      if (current !== generation.current) return;
      setItems((rows) => [...(rows ?? []), ...page.items]); setNextCursor(page.nextCursor); setHasMore(page.hasMore);
    } catch (cause) { if (current === generation.current) setError(cause); }
    finally { setLoadingMore(false); }
  }, [nextCursor, loadingMore]);
  return { items, setItems, loading: items === null && error === null, loadingMore, hasMore, error, loadMore, reload };
}
