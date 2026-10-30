import type { RefundKind, TenderParts } from "@domain";
import { call, enc, type GenericResponse } from "./core";
import type { BookingResponse } from "./booking";

export interface CancelResponse {
  booking?: { id: string; status: string };
  refund?: { refundCents?: number; retainedCents?: number; perTender?: TenderParts };
  [k: string]: unknown;
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

export const bookingActionsApi = {
  reschedule: (id: string, localStart: string, key: string) =>
    call<BookingResponse>("POST", `/bookings/${enc(id)}/reschedule`, { localStart }, key),
  cancel: (id: string, reason: string, key: string) =>
    call<CancelResponse>("POST", `/bookings/${enc(id)}/cancel`, { reason }, key),
  noShow: (id: string, who: "client" | "tasker", key: string) =>
    call<GenericResponse>("POST", `/bookings/${enc(id)}/no-show`, { who }, key),
  tip: (id: string, amountCents: number, key: string) =>
    call<TipResponse>("POST", `/bookings/${enc(id)}/tip`, { amountCents }, key),
  refund: (id: string, b: RefundRequestBody, key: string) =>
    call<RefundResponse>("POST", `/bookings/${enc(id)}/refund`, b, key),
  /** Staff only (clients get 404). Side-effect free: the API does not store its Idempotency-Key. */
  refundPreview: (id: string, b: RefundRequestBody) =>
    call<RefundPreviewResponse>("POST", `/bookings/${enc(id)}/refund-preview`, b),
  review: (id: string, rating: number, body: string, key: string) =>
    call<GenericResponse>("POST", `/bookings/${enc(id)}/review`, { rating, body }, key),
};
