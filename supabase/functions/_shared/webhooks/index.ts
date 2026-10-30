// Stripe webhook core: verify the signature (HMAC SHA-256 with STRIPE_WEBHOOK_SECRET), process each event id
// exactly once (the stripe_events insert is part of the same database transaction as the event's effects),
// and dispatch to the per-area handlers through a registry (payments.ts, refunds.ts, disputes.ts, connect.ts).
//
// Adding an event type: export it in the `handlers` map of the area file that owns it. Handlers never touch
// the transport: they receive an EventCtx and return the JSON body for Stripe.

import { Db, env, UnitOfWork } from "../db.ts";
import { errorBody, HttpError, json, toHttpError } from "../http.ts";
import { verifyStripeSignature } from "../provider/index.ts";
import { handlers as connectHandlers } from "./connect.ts";
import { handlers as disputeHandlers } from "./disputes.ts";
import { handlers as paymentHandlers } from "./payments.ts";
import { handlers as refundHandlers } from "./refunds.ts";

export interface StripeEvent {
  id: string;
  type: string;
  /** false for test mode and for simulated events. Live-mode events are refused by WS4 (plan 6.4). */
  livemode?: boolean;
  api_version?: string;
  /** Connected account id for Connect events. */
  account?: string;
  data: { object: Record<string, unknown> };
}

/** What every event handler receives. */
export interface EventCtx {
  db: Db;
  ev: StripeEvent;
  now: Date;
  /** The caller already holds the booking/points leases (the admin simulate hook does). */
  lockHeld: boolean;
  /** Store the event id with no other effect and return `{received: true, ...result}`. */
  recordOnly(result: Record<string, unknown>): Promise<Record<string, unknown>>;
}

export type EventHandler = (ec: EventCtx) => Promise<Record<string, unknown>>;

/** event type -> handler. One owner per type; a duplicate type is a programming error. */
function buildRegistry(): Map<string, EventHandler> {
  const reg = new Map<string, EventHandler>();
  for (const area of [paymentHandlers, refundHandlers, disputeHandlers, connectHandlers]) {
    for (const [type, h] of Object.entries(area)) {
      if (reg.has(type)) throw new Error(`webhook event ${type} has two handlers`);
      reg.set(type, h);
    }
  }
  return reg;
}
const REGISTRY = buildRegistry();

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
  const handler = REGISTRY.get(ev.type);
  const rec = (result: Record<string, unknown>) => recordOnly(db, ev, result);
  if (!handler) return rec({ handled: false });
  return handler({ db, ev, now, lockHeld: opts.lockHeld === true, recordOnly: rec });
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
