// Typed client for the `api` Edge Function (see docs/API.md).
// Every call sends the user's Supabase JWT; every mutation sends an Idempotency-Key header.
// The server is the source of truth for money; the UI only previews with the shared domain code.
//
// Idempotency keys: a key is reused for a retry whenever the first attempt may not have finished:
// network errors, 5xx, and `409 busy` / `409 request_in_progress` (the API never stores those, so a
// retry with the same key runs the request once). Any other 4xx is a final answer that the API
// stores and would replay for that key, so the UI starts a new key after it.

import { useCallback, useRef, useState } from "react";
import { supabase, SUPABASE_ANON_KEY, SUPABASE_URL } from "../supabase";

export const API_BASE = `${SUPABASE_URL}/functions/v1/api`;

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

/** 409 codes that mean "not processed yet, try again with the same Idempotency-Key". */
export const RETRY_SAME_KEY_CODES = new Set(["busy", "request_in_progress"]);

/** True when a failed mutation must be retried with the SAME Idempotency-Key. */
export function keepsIdempotencyKey(e: unknown): boolean {
  if (!(e instanceof ApiError)) return true; // unknown failure: assume it may have run
  if (e.status === 0 || e.status >= 500) return true;
  return e.status === 409 && RETRY_SAME_KEY_CODES.has(e.code);
}

/** Automatic retries (same key) for `409 busy` / `request_in_progress`, in ms. */
export const BUSY_RETRY_DELAYS_MS = [400, 800, 1600];

type ReplayListener = () => void;
const replayListeners = new Set<ReplayListener>();
/** Called when the API answers with a stored response (`Idempotent-Replayed: true`). Returns an unsubscribe. */
export function onIdempotentReplay(fn: ReplayListener): () => void {
  replayListeners.add(fn);
  return () => replayListeners.delete(fn);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function newIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export async function call<T>(
  method: "GET" | "POST",
  path: string,
  body?: unknown,
  idempotencyKey?: string,
): Promise<T> {
  // One key for every attempt of this call: a busy booking is retried with the same key, so the
  // request can never run twice.
  const key = method === "POST" ? (idempotencyKey ?? newIdempotencyKey()) : undefined;
  for (let attempt = 0; ; attempt++) {
    try {
      return await callOnce<T>(method, path, body, key);
    } catch (e) {
      const retryable =
        e instanceof ApiError && e.status === 409 && RETRY_SAME_KEY_CODES.has(e.code);
      if (!retryable || attempt >= BUSY_RETRY_DELAYS_MS.length) throw e;
      await sleep(BUSY_RETRY_DELAYS_MS[attempt]);
    }
  }
}

async function callOnce<T>(
  method: "GET" | "POST",
  path: string,
  body: unknown,
  idempotencyKey: string | undefined,
): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    apikey: SUPABASE_ANON_KEY,
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (e) {
    throw new ApiError(0, "network_error", `Could not reach the API: ${(e as Error).message}`);
  }
  if (res.headers.get("Idempotent-Replayed") === "true") replayListeners.forEach((fn) => fn());
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON */
  }
  if (!res.ok) {
    const err = (json as { error?: { code?: string; message?: string } } | null)?.error;
    throw new ApiError(
      res.status,
      err?.code ?? `http_${res.status}`,
      err?.message ?? (text || res.statusText),
    );
  }
  return json as T;
}

export interface GenericResponse {
  [k: string]: unknown;
}

export const enc = encodeURIComponent;

export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  if (e instanceof Error) return e.message;
  return String(e);
}

/**
 * Run a mutation with an Idempotency-Key. The same key is reused when the request may not have
 * finished (network error, 5xx, `409 busy` / `request_in_progress`; the API client already retries
 * busy responses a few times with that key), so a retry can't double-charge. The key is rotated after
 * a success or any other 4xx, whose response the API stores and would replay for the old key.
 */
export function useAction<A extends unknown[], R>(
  fn: (key: string, ...args: A) => Promise<R>,
  opts?: {
    /**
     * Re-read the server state after a failure that may have gone through (network error, 5xx).
     * While it runs, `checking` is true and the message says we are checking.
     */
    recheck?: () => Promise<unknown>;
  },
) {
  const key = useRef(newIdempotencyKey());
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const recheck = opts?.recheck;
  const run = useCallback(
    async (...args: A): Promise<R | undefined> => {
      if (pending) return undefined;
      setPending(true);
      setError(null);
      setUncertain(false);
      try {
        const r = await fn(key.current, ...args);
        key.current = newIdempotencyKey();
        return r;
      } catch (e) {
        // Keep the key when the request may not have finished (network, 5xx, 409 busy /
        // request_in_progress), so the user's retry cannot run it twice. A final 4xx answer is stored
        // by the API for that key, so the next attempt needs a new one.
        const mayHaveRun = keepsIdempotencyKey(e);
        if (!mayHaveRun) key.current = newIdempotencyKey();
        setError(errorMessage(e));
        if (mayHaveRun) {
          setUncertain(true);
          if (recheck) {
            setChecking(true);
            setError("Checking whether this went through…");
            try {
              await recheck();
            } catch {
              /* the re-read failing changes nothing: the message below still tells the truth */
            } finally {
              setChecking(false);
            }
            setError(
              `${errorMessage(e)} We re-checked your latest data. If the change is not there, trying again is safe: the same request key is used, so it cannot run twice.`,
            );
          }
        }
        return undefined;
      } finally {
        setPending(false);
      }
    },
    [fn, pending, recheck],
  );
  return { run, pending, error, setError, checking, uncertain };
}
