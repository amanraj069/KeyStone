"use client";

import { type DependencyList, useCallback, useEffect, useRef, useState } from "react";

export interface ApiState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  /** Fetches again, keeping the current data on screen until the new data arrives. */
  reload: () => void;
}

/**
 * Loads data with an API function and aborts the request when the inputs change
 * or the component unmounts. Pass `null` to load nothing.
 */
export function useApi<T>(load: ((signal: AbortSignal) => Promise<T>) | null, deps: DependencyList): ApiState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(load !== null);
  const [version, setVersion] = useState(0);
  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    const current = loadRef.current;
    if (!current) {
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    current(controller.signal)
      .then((value) => {
        setData(value);
        setError(null);
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, version]);

  const reload = useCallback(() => setVersion((v) => v + 1), []);
  return { data, error, loading, reload };
}
