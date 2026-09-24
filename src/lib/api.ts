// Typed client for the `api` Edge Function (see docs/API.md).
// Every call sends the user's Supabase JWT; every mutation sends an Idempotency-Key header.
// The server is the source of truth for money; the UI only previews with the shared domain code.
//
// Idempotency keys: a key is reused for a retry whenever the first attempt may not have finished:
// network errors, 5xx, and `409 busy` / `409 request_in_progress` (the API never stores those, so a
// retry with the same key runs the request once). Any other 4xx is a final answer that the API
// stores and would replay for that key, so the UI starts a new key after it.

import type { Allocation, Quote, RefundKind, TenderParts } from "@domain";
import { supabase, SUPABASE_ANON_KEY, SUPABASE_URL } from "./supabase";

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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function newIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

async function call<T>(
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

// ---- Request / response types (contract with the API agent) ----------------

export interface QuoteRequest {
  taskerId: string;
  minutes: number;
  promoCode?: string;
  pointsRequested?: number;
}
export interface QuoteResponse {
  quote: Quote;
  allocation: Allocation;
  discountCents?: number;
  policyVersion?: number;
}

export interface CreateBookingRequest {
  taskerId: string;
  localStart: string; // "YYYY-MM-DDTHH:mm" in tz
  tz: string;
  minutes: number;
  description: string;
  promoCode?: string;
  pointsRequested?: number;
}
export interface BookingResponse {
  booking: { id: string; status: string; [k: string]: unknown };
  [k: string]: unknown;
}

export interface CancelResponse {
  booking?: { id: string; status: string };
  refund?: { refundCents?: number; retainedCents?: number; perTender?: TenderParts };
  [k: string]: unknown;
}

export interface CompleteRequest {
  extraMinutes?: number;
  expensesCents?: number;
}
export interface RefundRequestBody {
  kind: RefundKind;
  amountCents: number;
  reason: string;
  approvedBy?: string;
}

/** A client's refund REQUEST (202): recorded for support, nothing has been refunded yet. */
export interface RefundRequested {
  requested: true;
  bookingId: string;
  kind: RefundKind;
  amountCents: number;
}

/** A refund issued by support or an admin (200). */
export interface RefundIssued {
  refund: {
    id: string;
    kind: RefundKind;
    amountCents: number;
    perTender: TenderParts;
    taskerClawbackCents: number;
    platformCostCents: number;
    requiresApproval: boolean;
    approvedBy: string | null;
    pointsReturned: number;
    pointsClawedBack: number;
    pointsDebt: number;
    providerRefundIds: string[];
  };
  [k: string]: unknown;
}

export type RefundResponse = RefundRequested | RefundIssued;

export function isRefundRequest(r: RefundResponse | null | undefined): r is RefundRequested {
  return !!r && (r as RefundRequested).requested === true;
}

/** `POST /bookings/:id/refund-preview` (support/admin): exactly what `refund` would do, no side effects. */
export interface RefundPreviewResponse {
  refundableCents: number;
  plan: {
    perTender: TenderParts;
    taskerClawbackCents: number;
    platformCostCents: number;
    requiresApproval: boolean;
    amountCents: number;
  };
  pointsReturned: number;
  pointsClawedBack: number;
  policyVersion: number;
}

export interface TipResponse {
  tip: {
    id: string;
    amountCents: number;
    taskerGets: number;
    platformFee: number;
    paymentIntentId: string;
    tippedTotalCents: number;
  };
}
export interface GenericResponse {
  [k: string]: unknown;
}

const enc = encodeURIComponent;

export const api = {
  quote: (b: QuoteRequest) => call<QuoteResponse>("POST", "/quote", b, newIdempotencyKey()),
  createBooking: (b: CreateBookingRequest, key: string) =>
    call<BookingResponse>("POST", "/bookings", b, key),
  accept: (id: string, key: string) =>
    call<BookingResponse>("POST", `/bookings/${enc(id)}/accept`, {}, key),
  decline: (id: string, key: string) =>
    call<BookingResponse>("POST", `/bookings/${enc(id)}/decline`, {}, key),
  reschedule: (id: string, localStart: string, key: string) =>
    call<BookingResponse>("POST", `/bookings/${enc(id)}/reschedule`, { localStart }, key),
  cancel: (id: string, reason: string, key: string) =>
    call<CancelResponse>("POST", `/bookings/${enc(id)}/cancel`, { reason }, key),
  noShow: (id: string, who: "client" | "tasker", key: string) =>
    call<GenericResponse>("POST", `/bookings/${enc(id)}/no-show`, { who }, key),
  start: (id: string, key: string) =>
    call<BookingResponse>("POST", `/bookings/${enc(id)}/start`, {}, key),
  complete: (id: string, b: CompleteRequest, key: string) =>
    call<BookingResponse>("POST", `/bookings/${enc(id)}/complete`, b, key),
  tip: (id: string, amountCents: number, key: string) =>
    call<TipResponse>("POST", `/bookings/${enc(id)}/tip`, { amountCents }, key),
  refund: (id: string, b: RefundRequestBody, key: string) =>
    call<RefundResponse>("POST", `/bookings/${enc(id)}/refund`, b, key),
  /** Staff only (clients get 404). Side-effect free: the API does not store its Idempotency-Key. */
  refundPreview: (id: string, b: RefundRequestBody) =>
    call<RefundPreviewResponse>("POST", `/bookings/${enc(id)}/refund-preview`, b),
  review: (id: string, rating: number, body: string, key: string) =>
    call<GenericResponse>("POST", `/bookings/${enc(id)}/review`, { rating, body }, key),
  runPayouts: (key: string) => call<GenericResponse>("POST", "/payouts/run", {}, key),
  setTaskerStatus: (
    taskerId: string,
    status: "active" | "suspended",
    reason: string,
    key: string,
  ) =>
    call<GenericResponse>(
      "POST",
      `/admin/taskers/${enc(taskerId)}/status`,
      { status, reason },
      key,
    ),
  simulateDispute: (bookingId: string, outcome: "won" | "lost", key: string) =>
    call<GenericResponse>("POST", "/admin/disputes/simulate", { bookingId, outcome }, key),
};

export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  if (e instanceof Error) return e.message;
  return String(e);
}
