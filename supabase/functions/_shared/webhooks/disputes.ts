// Webhook handlers for charge.dispute.* events (moved unchanged from the old _shared/stripe-webhook.ts).

import { BookingRow, Db, loadBooking, UnitOfWork, withLocks } from "../db.ts";
import { toHttpError } from "../http.ts";
import { closeDispute, DisputeRow, openDispute } from "../disputes.ts";
import type { EventCtx, EventHandler, StripeEvent } from "./index.ts";

async function bookingIdForPaymentIntent(db: Db, pi: string): Promise<string | null> {
  if (!/^pi_[A-Za-z0-9_]+$/.test(pi)) return null;
  const { data } = await db
    .from("bookings")
    .select("id")
    .or(`stripe_payment_intent_id.eq.${pi},extra_payment_intent_id.eq.${pi}`)
    .limit(1);
  return data && data.length > 0 ? (data[0].id as string) : null;
}

async function handleDisputeEvent(db: Db, ev: StripeEvent, bookingId: string, now: Date) {
  // Re-check under the lease: another delivery of the same event may have finished meanwhile.
  const { data: seen } = await db.from("stripe_events").select("id").eq("id", ev.id).maybeSingle();
  if (seen) return { received: true, duplicate: true };
  const obj = ev.data.object;
  const disputeId = obj.id as string;
  const uow = new UnitOfWork(`stripe:${ev.id}`);
  uow.insert("stripe_events", { id: ev.id, type: ev.type, object_id: disputeId ?? null });
  const { data: existing } = await db
    .from("disputes")
    .select("*")
    .eq("stripe_dispute_id", disputeId)
    .maybeSingle();
  let dRow = existing as DisputeRow | null;
  let b: BookingRow = await loadBooking(db, bookingId);
  let result: Record<string, unknown>;
  if (!dRow) {
    const id = crypto.randomUUID();
    const amount = Number(obj.amount ?? 0);
    openDispute(uow, b, id, disputeId, amount);
    dRow = {
      id,
      booking_id: b.id,
      stripe_dispute_id: disputeId,
      amount_cents: amount,
      fee_cents: 0,
      status: "needs_response",
      recovered_from_tasker_cents: 0,
      created_at: now.toISOString(),
      closed_at: null,
    };
    if (b.status === "completed" || b.status === "no_show_client") b = { ...b, status: "disputed" };
  }
  const status = obj.status as string;
  if (ev.type === "charge.dispute.closed" && (status === "won" || status === "lost")) {
    result = { handled: true, ...(await closeDispute(db, uow, b, dRow, status, now)) };
  } else if (ev.type === "charge.dispute.updated" && status === "under_review" && existing) {
    uow.update("disputes", { id: dRow.id }, { status: "under_review" });
    result = { handled: true, disputeId: dRow.id };
  } else {
    result = { handled: true, disputeId: dRow.id };
  }
  try {
    await uow.commit(db);
  } catch (e) {
    if (toHttpError(e).code === "duplicate") return { received: true, duplicate: true };
    throw e;
  }
  return { received: true, ...result };
}

async function onDisputeEvent({ db, ev, now, lockHeld, recordOnly }: EventCtx) {
  const obj = ev.data?.object ?? {};
  const { data: known } = await db
    .from("disputes")
    .select("booking_id")
    .eq("stripe_dispute_id", String(obj.id ?? ""))
    .maybeSingle();
  const pi = typeof obj.payment_intent === "string" ? obj.payment_intent : "";
  const bookingId =
    (known?.booking_id as string | undefined) ??
    (pi ? await bookingIdForPaymentIntent(db, pi) : null);
  if (!bookingId)
    return recordOnly({ handled: false, reason: "no booking for this payment intent" });
  if (lockHeld) return handleDisputeEvent(db, ev, bookingId, now);
  const b = await loadBooking(db, bookingId);
  return withLocks(db, [`booking:${bookingId}`, `points:${b.client_id}`], () =>
    handleDisputeEvent(db, ev, bookingId, now),
  );
}

export const handlers: Record<string, EventHandler> = {
  "charge.dispute.created": onDisputeEvent,
  "charge.dispute.updated": onDisputeEvent,
  "charge.dispute.closed": onDisputeEvent,
};
