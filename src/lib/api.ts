// Typed client for the `api` Edge Function (see docs/SPEC.md "API").
// Every call sends the user's Supabase JWT; every mutation sends an Idempotency-Key header.
// The server is the source of truth for money; the UI only previews with the shared domain code.

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
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    apikey: SUPABASE_ANON_KEY,
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (method === "POST") headers["Idempotency-Key"] = idempotencyKey ?? newIdempotencyKey();
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
    call<GenericResponse>("POST", `/bookings/${enc(id)}/tip`, { amountCents }, key),
  refund: (id: string, b: RefundRequestBody, key: string) =>
    call<GenericResponse>("POST", `/bookings/${enc(id)}/refund`, b, key),
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
