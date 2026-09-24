// Stripe webhook: verify the signature (HMAC SHA-256 with STRIPE_WEBHOOK_SECRET), process each event id
// exactly once (the stripe_events insert is part of the same database transaction as the event's effects).

import { BookingRow, Db, env, loadBooking, UnitOfWork, withLocks } from "./db.ts";
import { errorBody, HttpError, json, toHttpError } from "./http.ts";
import { verifyStripeSignature } from "./provider/index.ts";
import { closeDispute, DisputeRow, openDispute } from "./disputes.ts";

export interface StripeEvent {
  id: string;
  type: string;
  data: { object: Record<string, unknown> };
}

const DISPUTE_EVENTS = new Set([
  "charge.dispute.created",
  "charge.dispute.updated",
  "charge.dispute.closed",
]);

async function bookingIdForPaymentIntent(db: Db, pi: string): Promise<string | null> {
  if (!/^pi_[A-Za-z0-9_]+$/.test(pi)) return null;
  const { data } = await db
    .from("bookings")
    .select("id")
    .or(`stripe_payment_intent_id.eq.${pi},extra_payment_intent_id.eq.${pi}`)
    .limit(1);
  return data && data.length > 0 ? (data[0].id as string) : null;
}

async function recordOnly(db: Db, ev: StripeEvent, result: Record<string, unknown>) {
  const uow = new UnitOfWork();
  uow.insert("stripe_events", {
    id: ev.id,
    type: ev.type,
    object_id: (ev.data?.object?.id as string) ?? null,
  });
  try {
    await uow.commit(db);
  } catch (e) {
    if (toHttpError(e).code === "duplicate") return { received: true, duplicate: true };
    throw e;
  }
  return { received: true, ...result };
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

/**
 * Process one (verified) Stripe event. Dispute events take the booking's lease (and the client's
 * points lease, for clawbacks) unless the caller already holds them (`lockHeld`).
 */
export async function processStripeEvent(
  db: Db,
  ev: StripeEvent,
  now: Date,
  opts: { lockHeld?: boolean } = {},
): Promise<Record<string, unknown>> {
  if (!ev || typeof ev.id !== "string" || typeof ev.type !== "string") {
    throw new HttpError(400, "bad_event", "not a Stripe event");
  }
  const { data: seen } = await db.from("stripe_events").select("id").eq("id", ev.id).maybeSingle();
  if (seen) return { received: true, duplicate: true };
  if (!DISPUTE_EVENTS.has(ev.type)) return recordOnly(db, ev, { handled: false });

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
    return recordOnly(db, ev, { handled: false, reason: "no booking for this payment intent" });
  if (opts.lockHeld) return handleDisputeEvent(db, ev, bookingId, now);
  const b = await loadBooking(db, bookingId);
  return withLocks(db, [`booking:${bookingId}`, `points:${b.client_id}`], () =>
    handleDisputeEvent(db, ev, bookingId, now),
  );
}

export async function handleStripeWebhook(req: Request, db: Db): Promise<Response> {
  try {
    const secret = env("STRIPE_WEBHOOK_SECRET");
    if (!secret)
      throw new HttpError(503, "webhook_not_configured", "STRIPE_WEBHOOK_SECRET is not set");
    const raw = await req.text();
    const ok = await verifyStripeSignature(
      raw,
      req.headers.get("stripe-signature"),
      secret,
      Math.floor(Date.now() / 1000),
    );
    if (!ok) throw new HttpError(400, "bad_signature", "invalid Stripe signature");
    let ev: StripeEvent;
    try {
      ev = JSON.parse(raw) as StripeEvent;
    } catch {
      throw new HttpError(400, "bad_json", "event body is not JSON");
    }
    return json(await processStripeEvent(db, ev, new Date()));
  } catch (e) {
    const h = toHttpError(e);
    if (h.status >= 500) console.error("stripe webhook error", h.code, h.message);
    return json(errorBody(h.code, h.message), h.status);
  }
}
