// HTTP helpers shared by the Edge Functions. Errors are always `{error: {code, message}}`.

export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

/**
 * Error codes that describe a temporary condition (another request holds the booking, the same
 * Idempotency-Key is still running). They are never stored as the final result of an
 * Idempotency-Key, so a retry with the same key runs the request again.
 */
export const TRANSIENT_CODES = new Set(["busy", "request_in_progress"]);

export const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, idempotency-key, x-test-now, x-test-clock, stripe-signature",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Expose-Headers": "idempotent-replayed",
};

export function json(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders, ...extra },
  });
}

export function errorBody(code: string, message: string, details?: unknown) {
  return { error: details === undefined ? { code, message } : { code, message, details } };
}

/** Map any thrown value to an HttpError. Plain `Error`s from the domain are business-rule violations (422). */
export function toHttpError(e: unknown): HttpError {
  if (e instanceof HttpError) return e;
  // PostgREST / Postgres errors from supabase-js
  const pg = e as { code?: string; message?: string; details?: string; hint?: string };
  if (
    pg &&
    typeof pg === "object" &&
    typeof pg.code === "string" &&
    typeof pg.message === "string" &&
    /^[0-9A-Z]{5}$/.test(pg.code)
  ) {
    return pgToHttp(pg);
  }
  if (e instanceof Error) {
    const m = e.message;
    if (m.startsWith("conflict:")) {
      return new HttpError(
        409,
        m.includes("slot_taken") ? "slot_taken" : "conflict",
        m.replace(/^conflict:\s*/, ""),
      );
    }
    return new HttpError(422, "rule_violation", m);
  }
  return new HttpError(500, "internal", String(e));
}

export function pgToHttp(pg: { code?: string; message?: string; details?: string }): HttpError {
  const msg = pg.message ?? "database error";
  if (msg.startsWith("conflict:")) {
    const clean = msg.replace(/^conflict:\s*/, "");
    return new HttpError(409, clean.startsWith("slot_taken") ? "slot_taken" : "conflict", clean);
  }
  if (msg.startsWith("invalid:"))
    return new HttpError(422, "invalid", msg.replace(/^invalid:\s*/, ""));
  if (pg.code === "23505") {
    if (msg.includes("bookings_no_double_slot")) {
      return new HttpError(409, "slot_taken", "tasker already has a booking at that time");
    }
    return new HttpError(409, "duplicate", msg);
  }
  if (pg.code === "23514") return new HttpError(409, "constraint_violation", msg);
  if (pg.code === "23503") return new HttpError(422, "invalid_reference", msg);
  return new HttpError(500, "db_error", msg);
}

export async function readJson(req: Request): Promise<Record<string, unknown>> {
  const text = await req.text();
  if (!text.trim()) return {};
  try {
    const v = JSON.parse(text);
    if (v === null || typeof v !== "object" || Array.isArray(v)) throw new Error();
    return v as Record<string, unknown>;
  } catch {
    throw new HttpError(400, "bad_json", "request body must be a JSON object");
  }
}

// ---- Input validation --------------------------------------------------------------------------

export function reqString(b: Record<string, unknown>, k: string): string {
  const v = b[k];
  if (typeof v !== "string" || !v.trim())
    throw new HttpError(400, "bad_request", `${k} is required`);
  return v;
}
export function optString(b: Record<string, unknown>, k: string): string | undefined {
  const v = b[k];
  if (v === undefined || v === null || v === "") return undefined;
  if (typeof v !== "string") throw new HttpError(400, "bad_request", `${k} must be a string`);
  return v;
}
export function reqInt(b: Record<string, unknown>, k: string, min = 0): number {
  const v = b[k];
  if (typeof v !== "number" || !Number.isSafeInteger(v) || v < min) {
    throw new HttpError(400, "bad_request", `${k} must be an integer >= ${min}`);
  }
  return v;
}
export function optInt(b: Record<string, unknown>, k: string, min = 0): number | undefined {
  if (b[k] === undefined || b[k] === null) return undefined;
  return reqInt(b, k, min);
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function reqUuid(b: Record<string, unknown>, k: string): string {
  const v = reqString(b, k);
  if (!UUID_RE.test(v)) throw new HttpError(400, "bad_request", `${k} must be a uuid`);
  return v.toLowerCase();
}

export async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** A deterministic (name-based) UUID for a key, so retries of the same operation reuse the same row id. */
export async function uuidFromKey(key: string): Promise<string> {
  const h = await sha256Hex(key);
  const variant = ((Number.parseInt(h[16], 16) & 0x3) | 0x8).toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
