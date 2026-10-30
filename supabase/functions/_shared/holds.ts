// Card money moves for the booking lifecycle, over the payments provider contract (docs/contracts.md 4.4).
//
// WS7 owns WHEN money moves (plan, capture, off-session fallback); the provider owns HOW. The new-contract
// provider methods (holdOnSession, chargeOffSession, chargeOnSession) land with WS4. Until a provider
// implements one it throws `not_implemented`, and these helpers fall back to the legacy methods that behave
// the same way (authorize / charge), so the booking flows work on both sides of that merge. Delete the
// fallbacks when the deprecated wrappers are removed (Wave 2).
//
// This file imports only provider types, so it is unit-testable without a database.

import {
  BalanceTxn,
  IntentResult,
  PaymentError,
  PaymentInput,
  PaymentsProvider,
} from "./provider/types.ts";
import type { PaymentState } from "./domain/booking.ts";

/** What a provider call returns, in one shape. Legacy results carry no charge, clientSecret or balance txn. */
export interface Moved {
  intentId: string;
  status: IntentResult["status"];
  chargeId?: string;
  captureBefore?: string;
  clientSecret?: string;
  balanceTxn?: BalanceTxn;
}

const isNotImplemented = (e: unknown) => e instanceof PaymentError && e.code === "not_implemented";

function fromIntent(r: IntentResult): Moved {
  return {
    intentId: r.id,
    status: r.status,
    chargeId: r.chargeId,
    captureBefore: r.captureBefore,
    clientSecret: r.clientSecret,
    balanceTxn: r.balanceTxn,
  };
}

/** A declined or unusable card is an error to the caller, with Stripe's decline code when there is one. */
function assertUsable(r: IntentResult, okStatuses: IntentResult["status"][]): IntentResult {
  if (okStatuses.includes(r.status)) return r;
  if (r.status === "requires_payment_method") {
    throw new PaymentError(
      "card_declined",
      `Your card was declined${r.declineCode ? ` (${r.declineCode})` : ""}.`,
    );
  }
  throw new PaymentError("payment_not_completed", `the payment ended in status ${r.status}`);
}

/** Payment ids from the simulator never go to real Stripe. */
export function assertMethodFitsProvider(
  provider: PaymentsProvider,
  paymentMethodId: string,
): void {
  if (provider.name === "stripe" && paymentMethodId.startsWith("sim_")) {
    throw new PaymentError(
      "payment_method_invalid",
      "this is a simulated card; Stripe mode needs a real saved card or a new one",
      422,
    );
  }
}

// ---- Placing a hold -------------------------------------------------------------------------------

export interface HoldInput {
  amountCents: number;
  bookingId: string;
  customerId: string | null;
  /** The new-contract payment input from the request, if any. */
  payment: PaymentInput | null;
  /** The method to use when `payment` is a saved method or absent (the client's default, or a legacy field). */
  savedMethodId: string | null;
  idempotencyKey: string;
}

/**
 * Place the manual-capture hold now. `requires_action` (3DS) is returned, not thrown: the booking then waits as
 * `pending_payment` until the client completes it. A decline throws `card_declined`.
 */
export async function placeHold(provider: PaymentsProvider, i: HoldInput): Promise<Moved> {
  const payment: PaymentInput | null =
    i.payment ??
    (i.savedMethodId ? { kind: "saved_method", paymentMethodId: i.savedMethodId } : null);
  if (!payment)
    throw new PaymentError("payment_method_required", "a payment method is required", 422);
  if (payment.kind === "saved_method") assertMethodFitsProvider(provider, payment.paymentMethodId);
  try {
    if (!i.customerId && provider.name === "stripe")
      throw new PaymentError("customer_required", "no customer for this payment", 500);
    const r = await provider.holdOnSession({
      amountCents: i.amountCents,
      customerId: i.customerId ?? "",
      payment,
      bookingId: i.bookingId,
      idempotencyKey: i.idempotencyKey,
    });
    return fromIntent(assertUsable(r, ["requires_capture", "requires_action"]));
  } catch (e) {
    if (!isNotImplemented(e) || payment.kind !== "saved_method") throw e;
    const r = await provider.authorize({
      amountCents: i.amountCents,
      bookingId: i.bookingId,
      description: `TaskNest booking ${i.bookingId}`,
      paymentMethod: payment.paymentMethodId,
      idempotencyKey: i.idempotencyKey,
    });
    return { intentId: r.id, status: "requires_capture" };
  }
}

// ---- Charging a saved card with no live hold ------------------------------------------------------

export interface ChargeSavedInput {
  amountCents: number;
  bookingId: string;
  customerId: string | null;
  paymentMethodId: string | null;
  kind: "extras" | "fee" | "capture_fallback";
  /** Legacy provider kind and idempotency key (kept so retries of v1 flows stay deduplicated). */
  legacyKind: "extras" | "reauth";
  idempotencyKey: string;
  description: string;
}

/**
 * Charge a saved card off-session for exactly `amountCents` (plan 4.2: completion, cancellation fee, no-show fee
 * when no live hold exists; extras always). `requires_action` is returned for the caller to record as
 * `action_required`; a decline throws.
 */
export async function chargeSavedCard(
  provider: PaymentsProvider,
  i: ChargeSavedInput,
): Promise<Moved> {
  if (i.paymentMethodId) assertMethodFitsProvider(provider, i.paymentMethodId);
  try {
    if (!i.customerId || !i.paymentMethodId) {
      if (provider.name === "stripe")
        throw new PaymentError("payment_method_required", "no saved card on file", 422);
      throw new PaymentError("not_implemented", "no customer in legacy mode");
    }
    const r = await provider.chargeOffSession({
      amountCents: i.amountCents,
      customerId: i.customerId,
      paymentMethodId: i.paymentMethodId,
      bookingId: i.bookingId,
      kind: i.kind,
      idempotencyKey: i.idempotencyKey,
    });
    return fromIntent(assertUsable(r, ["succeeded", "requires_action"]));
  } catch (e) {
    if (!isNotImplemented(e)) throw e;
    const r = await provider.charge({
      amountCents: i.amountCents,
      bookingId: i.bookingId,
      description: i.description,
      paymentMethod: i.paymentMethodId ?? undefined,
      idempotencyKey: i.idempotencyKey,
      kind: i.legacyKind,
    });
    return { intentId: r.id, status: "succeeded" };
  }
}

// ---- Tips -----------------------------------------------------------------------------------------

export interface ChargeTipInput {
  amountCents: number;
  bookingId: string;
  customerId: string | null;
  paymentMethodId: string | null;
  /** Legacy `paymentMethod` request field (the fake provider's decline switch). */
  legacyMethod?: string;
  idempotencyKey: string;
}

/** A tip is an on-session charge: the client is there, so 3DS can be completed (`requires_action`). */
export async function chargeTip(provider: PaymentsProvider, i: ChargeTipInput): Promise<Moved> {
  if (i.paymentMethodId) assertMethodFitsProvider(provider, i.paymentMethodId);
  try {
    if (!i.customerId || !i.paymentMethodId) throw new PaymentError("not_implemented", "legacy");
    const r = await provider.chargeOnSession({
      amountCents: i.amountCents,
      customerId: i.customerId,
      paymentMethodId: i.paymentMethodId,
      bookingId: i.bookingId,
      kind: "tip",
      idempotencyKey: i.idempotencyKey,
    });
    return fromIntent(assertUsable(r, ["succeeded", "requires_action"]));
  } catch (e) {
    if (!isNotImplemented(e)) throw e;
    const r = await provider.charge({
      amountCents: i.amountCents,
      bookingId: i.bookingId,
      description: `TaskNest tip ${i.bookingId}`,
      paymentMethod: i.legacyMethod ?? i.paymentMethodId ?? undefined,
      idempotencyKey: i.idempotencyKey,
      kind: "tip",
    });
    return { intentId: r.id, status: "succeeded" };
  }
}

// ---- Is there a live hold? ------------------------------------------------------------------------

/** The subset of a booking row that decides whether its hold can still be captured. */
export interface HoldFacts {
  stripe_payment_intent_id: string | null;
  payment_state: PaymentState;
  capture_before: string | null;
  auth_expires_at: string | null;
}

/**
 * Can the booking's hold be captured right now? v2 bookings: only in `hold_active` (and before
 * `capture_before`). v1 bookings (`payment_state = 'none'`): the old 7-day authorization, until `auth_expires_at`.
 */
export function hasLiveHold(b: HoldFacts, now: Date): boolean {
  if (!b.stripe_payment_intent_id) return false;
  if (b.payment_state === "none") {
    return !(b.auth_expires_at && now > new Date(b.auth_expires_at));
  }
  if (b.payment_state !== "hold_active") return false;
  return !(b.capture_before && now >= new Date(b.capture_before));
}
