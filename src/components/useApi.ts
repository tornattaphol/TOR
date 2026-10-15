"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export interface ApiEnvelope<T> {
  data: T;
  meta: Record<string, unknown> & { generatedAt?: string; lastUpdated?: string | null; disclaimer?: string; sources?: { id: string; draws: number }[]; empty?: boolean };
}

export interface ApiFailure {
  status: number;
  code: string;
  message: string;
}

export interface ApiState<T> {
  data: ApiEnvelope<T> | null;
  error: ApiFailure | null;
  loading: boolean;
  reload: () => void;
}

/** Fetches a JSON API endpoint with loading/error state; aborts stale requests when the URL changes. */
export function useApi<T>(url: string | null): ApiState<T> {
  const [data, setData] = useState<ApiEnvelope<T> | null>(null);
  const [error, setError] = useState<ApiFailure | null>(null);
  const [loading, setLoading] = useState<boolean>(Boolean(url));
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  const seq = useRef(0);

  useEffect(() => {
    if (!url) {
      setLoading(false);
      return;
    }
    const ctrl = new AbortController();
    const mine = ++seq.current;
    setLoading(true);
    setError(null);
    fetch(url, { signal: ctrl.signal, headers: { Accept: "application/json" } })
      .then(async (res) => {
        const body = await res.json().catch(() => null);
        if (mine !== seq.current) return;
        if (!res.ok) {
          const e = body?.error;
          setData(null);
          setError({ status: res.status, code: e?.code ?? "HTTP_ERROR", message: e?.message ?? `เกิดข้อผิดพลาด (HTTP ${res.status})` });
        } else {
          setData(body as ApiEnvelope<T>);
        }
      })
      .catch((e: unknown) => {
        if ((e as Error)?.name === "AbortError" || mine !== seq.current) return;
        setData(null);
        setError({ status: 0, code: "NETWORK_ERROR", message: "เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณาตรวจสอบเครือข่ายแล้วลองใหม่" });
      })
      .finally(() => {
        if (mine === seq.current) setLoading(false);
      });
    return () => ctrl.abort();
  }, [url, tick]);

  return { data, error, loading, reload };
}
