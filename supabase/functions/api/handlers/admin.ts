// Admin tasker status, policy publishing, dispute simulation and test-only helpers.

import { MoneyPolicy, partsTotal, Tender } from "../../_shared/domain/index.ts";
import { loadBooking, loadPolicy, loadTenders, UnitOfWork, withLocks } from "../../_shared/db.ts";
import {
  HttpError,
  optInt,
  optString,
  pgToHttp,
  reqInt,
  reqString,
  reqUuid,
} from "../../_shared/http.ts";
import { pointsIssueTxn } from "../../_shared/postings.ts";
import { processStripeEvent } from "../../_shared/webhooks/index.ts";
import * as pts from "../../_shared/points-store.ts";
import { Ctx, requireRole } from "../context.ts";
import { mintTestClockToken } from "../test-clock.ts";

function requireFake(ctx: Ctx, what: string) {
  if (ctx.provider.name !== "fake") {
    throw new HttpError(
      403,
      "fake_provider_only",
      `${what} is only available with the fake payments provider`,
    );
  }
}

// ---- POST /admin/taskers/:id/status ------------------------------------------------------------

export async function setTaskerStatus(ctx: Ctx) {
  requireRole(ctx, "admin");
  const status = reqString(ctx.body, "status");
  const reason = reqString(ctx.body, "reason").trim();
  if (!["active", "suspended", "pending"].includes(status)) {
    throw new HttpError(400, "bad_request", "status must be active, suspended or pending");
  }
  const { data: existing, error } = await ctx.db
    .from("taskers")
    .select("id, status")
    .eq("id", ctx.params.id)
    .maybeSingle();
  if (error) throw pgToHttp(error);
  if (!existing) throw new HttpError(404, "not_found", "tasker not found");
  const uow = new UnitOfWork();
  uow.update(
    "taskers",
    { id: ctx.params.id },
    { status, suspended_at: status === "suspended" ? ctx.now.toISOString() : null },
  );
  uow.audit(ctx.user.id, `tasker_${status}`, "tasker", ctx.params.id, reason, {
    from: existing.status,
    to: status,
  });
  await uow.commit(ctx.db);
  const { data } = await ctx.db
    .from("taskers")
    .select(
      "id, display_name, headline, category, hourly_rate_cents, status, kyc_verified_at, suspended_at, created_at",
    )
    .eq("id", ctx.params.id)
    .single();
  return { tasker: data };
}

// ---- POST /admin/policies ------------------------------------------------------------------------

const TENDERS: Tender[] = ["card", "points", "wallet", "promo"];

/** Validate a complete money policy document before it can be published. Returns it normalized. */
export function validatePolicy(input: unknown): MoneyPolicy {
  const p = input as MoneyPolicy;
  const errors: string[] = [];
  const int = (v: unknown, min = 0, max = Number.MAX_SAFE_INTEGER) =>
    typeof v === "number" && Number.isSafeInteger(v) && v >= min && v <= max;
  const need = (ok: boolean, msg: string) => {
    if (!ok) errors.push(msg);
  };
  const isPermutation = (v: unknown) =>
    Array.isArray(v) && v.length === TENDERS.length && TENDERS.every((t) => v.includes(t));
  if (!p || typeof p !== "object" || Array.isArray(p))
    throw new HttpError(400, "bad_request", "policy must be an object");
  need(p.currency === "USD", "currency must be USD");
  need(int(p.clientServiceFeeBps, 0, 10_000), "clientServiceFeeBps must be 0..10000");
  need(int(p.taskerCommissionBps, 0, 10_000), "taskerCommissionBps must be 0..10000");
  need(int(p.taxBps, 0, 10_000), "taxBps must be 0..10000");
  const c = p.cancellation;
  need(
    !!c && Array.isArray(c.tiers) && c.tiers.length > 0,
    "cancellation.tiers must be a non-empty array",
  );
  for (const t of c?.tiers ?? []) {
    need(int(t.minHoursBefore, 0, 24 * 365), "each tier needs minHoursBefore 0..8760");
    need(int(t.refundBps, 0, 10_000), "each tier needs refundBps 0..10000");
    need(
      t.chargeMinutesOfRate === undefined || int(t.chargeMinutesOfRate, 1, 24 * 60),
      "chargeMinutesOfRate must be 1..1440",
    );
  }
  need(
    new Set((c?.tiers ?? []).map((t) => t.minHoursBefore)).size === (c?.tiers ?? []).length,
    "cancellation tiers must have distinct minHoursBefore",
  );
  need(int(c?.noShowRefundBps, 0, 10_000), "cancellation.noShowRefundBps must be 0..10000");
  need(
    typeof c?.serviceFeeRefundable === "boolean",
    "cancellation.serviceFeeRefundable must be boolean",
  );
  const tp = p.taskerPenalty;
  need(int(tp?.cancelFeeCents), "taskerPenalty.cancelFeeCents must be >= 0");
  need(int(tp?.strikesToSuspend, 1), "taskerPenalty.strikesToSuspend must be >= 1");
  need(int(tp?.strikeWindowDays, 1), "taskerPenalty.strikeWindowDays must be >= 1");
  const tips = p.tips;
  need(int(tips?.capBpsOfSubtotal, 0, 100_000), "tips.capBpsOfSubtotal must be >= 0");
  need(int(tips?.windowDays), "tips.windowDays must be >= 0");
  need(
    tips?.platformFeeBps === 0,
    "tips.platformFeeBps must be 0 (tips pass through 100% to the tasker)",
  );
  need(
    Array.isArray(tips?.allowedTenders) &&
      tips.allowedTenders.length > 0 &&
      tips.allowedTenders.every((t) => TENDERS.includes(t)),
    "tips.allowedTenders must be a non-empty list of tenders",
  );
  const pt = p.points;
  need(int(pt?.centsPerPoint, 1), "points.centsPerPoint must be >= 1");
  need(int(pt?.pointsPerDollarCash), "points.pointsPerDollarCash must be >= 0");
  need(int(pt?.minRedeemPoints), "points.minRedeemPoints must be >= 0");
  need(int(pt?.maxRedeemBpsOfTotal, 0, 10_000), "points.maxRedeemBpsOfTotal must be 0..10000");
  need(int(pt?.pendingDays), "points.pendingDays must be >= 0");
  need(int(pt?.expiryMonths, 1), "points.expiryMonths must be >= 1");
  need(int(pt?.reissueDaysOnExpiredRefund, 1), "points.reissueDaysOnExpiredRefund must be >= 1");
  need(int(pt?.reviewBonusPoints), "points.reviewBonusPoints must be >= 0");
  need(isPermutation(p.tenderUseOrder), "tenderUseOrder must list each tender once");
  need(isPermutation(p.refundOrder), "refundOrder must list each tender once");
  need(isPermutation(p.retentionOrder), "retentionOrder must list each tender once");
  need(int(p.payouts?.holdDays), "payouts.holdDays must be >= 0");
  need(int(p.refunds?.agentLimitCents), "refunds.agentLimitCents must be >= 0");
  need(int(p.refunds?.windowDays), "refunds.windowDays must be >= 0");
  need(p.refunds?.providerShare === "proportional", "refunds.providerShare must be proportional");
  need(int(p.auth?.validityDays, 1), "auth.validityDays must be >= 1");
  need(
    int(p.auth?.reauthBufferDays) && p.auth.reauthBufferDays < p.auth.validityDays,
    "auth.reauthBufferDays must be < validityDays",
  );
  need(int(p.booking?.taskerResponseHours, 1), "booking.taskerResponseHours must be >= 1");
  if (errors.length > 0) throw new HttpError(422, "invalid_policy", errors.join("; "), errors);
  return p;
}

export async function publishPolicy(ctx: Ctx) {
  requireRole(ctx, "admin");
  const policy = validatePolicy(ctx.body.policy);
  const effectiveFrom = new Date(reqString(ctx.body, "effectiveFrom"));
  if (Number.isNaN(effectiveFrom.getTime()))
    throw new HttpError(400, "bad_request", "effectiveFrom must be an ISO timestamp");
  if (effectiveFrom < ctx.now) {
    throw new HttpError(
      422,
      "rule_violation",
      "effectiveFrom must not be in the past (policies never apply retroactively)",
    );
  }
  const reason = reqString(ctx.body, "reason").trim();
  const { data, error } = await ctx.db.rpc("publish_money_policy", {
    p_policy: policy,
    p_effective_from: effectiveFrom.toISOString(),
    p_actor: ctx.user.id,
    p_reason: reason,
  });
  if (error) throw pgToHttp(error);
  const version = Number(data);
  return { version, effectiveFrom: effectiveFrom.toISOString(), policy: { ...policy, version } };
}

// ---- POST /admin/disputes/simulate (fake provider only) ------------------------------------------

export async function simulateDispute(ctx: Ctx) {
  requireRole(ctx, "admin");
  requireFake(ctx, "dispute simulation");
  const bookingId = reqUuid(ctx.body, "bookingId");
  const outcome = reqString(ctx.body, "outcome");
  if (!["open", "won", "lost"].includes(outcome))
    throw new HttpError(400, "bad_request", "outcome must be open, won or lost");
  const b0 = await loadBooking(ctx.db, bookingId);
  return withLocks(ctx.db, [`booking:${bookingId}`, `points:${b0.client_id}`], async () => {
    const b = await loadBooking(ctx.db, bookingId);
    if (!b.stripe_payment_intent_id || Number(b.captured_cents) <= 0) {
      throw new HttpError(422, "rule_violation", "booking has no captured card payment to dispute");
    }
    const { paid, refunded } = await loadTenders(ctx.db, b.id);
    const amount = optInt(ctx.body, "amountCents", 1) ?? paid.card - refunded.card;
    if (amount <= 0)
      throw new HttpError(422, "rule_violation", "nothing left on the card to dispute");

    const { data: open } = await ctx.db
      .from("disputes")
      .select("*")
      .eq("booking_id", b.id)
      .in("status", ["needs_response", "under_review"])
      .maybeSingle();
    const disputeId: string =
      open?.stripe_dispute_id ?? `dp_fake_${crypto.randomUUID().replaceAll("-", "").slice(0, 20)}`;
    const events: Record<string, unknown>[] = [];
    if (!open) {
      events.push(
        await processStripeEvent(
          ctx.db,
          {
            id: `evt_fake_${crypto.randomUUID()}`,
            type: "charge.dispute.created",
            data: {
              object: {
                id: disputeId,
                amount,
                payment_intent: b.stripe_payment_intent_id,
                status: "needs_response",
              },
            },
          },
          ctx.now,
          { lockHeld: true },
        ),
      );
    } else if (outcome === "open") {
      throw new HttpError(409, "dispute_open", "booking already has an open dispute");
    }
    if (outcome !== "open") {
      events.push(
        await processStripeEvent(
          ctx.db,
          {
            id: `evt_fake_${crypto.randomUUID()}`,
            type: "charge.dispute.closed",
            data: {
              object: {
                id: disputeId,
                amount,
                payment_intent: b.stripe_payment_intent_id,
                status: outcome,
              },
            },
          },
          ctx.now,
          { lockHeld: true },
        ),
      );
    }
    const { data: dispute } = await ctx.db
      .from("disputes")
      .select("*")
      .eq("stripe_dispute_id", disputeId)
      .maybeSingle();
    const { data: bal } = await ctx.db
      .from("tasker_balances")
      .select("balance_cents")
      .eq("tasker_id", b.tasker_id)
      .maybeSingle();
    const after = await loadTenders(ctx.db, b.id);
    const { data: booking } = await ctx.db
      .from("bookings")
      .select("id, status")
      .eq("id", b.id)
      .single();
    return {
      dispute,
      booking,
      events,
      taskerBalanceCents: Number(bal?.balance_cents ?? 0),
      refundableCents: partsTotal(after.paid) - partsTotal(after.refunded),
    };
  });
}

// ---- POST /admin/points/grant (fake provider only; test helper) -----------------------------------

export async function grantPoints(ctx: Ctx) {
  requireRole(ctx, "admin");
  requireFake(ctx, "points grant");
  const userId = reqUuid(ctx.body, "userId");
  const points = reqInt(ctx.body, "points", 1);
  if (points > 1_000_000) throw new HttpError(400, "bad_request", "points must be <= 1000000");
  const policy = await loadPolicy(ctx.db, undefined, ctx.now);
  return withLocks(ctx.db, [`points:${userId}`], async () => {
    const uow = new UnitOfWork(ctx.idemKey ? ctx.opKey : undefined);
    const lotId = pts.bonus(uow, userId, null, points, ctx.now, policy);
    uow.ledger(
      pointsIssueTxn("points_grant", undefined, userId, points, policy.points.centsPerPoint),
      lotId,
    );
    uow.audit(
      ctx.user.id,
      "points_granted",
      "user",
      userId,
      optString(ctx.body, "reason") ?? "test grant",
      { points },
    );
    await uow.commit(ctx.db);
    return { lotId, points };
  });
}

// ---- POST /admin/test-clock (fake provider only; test helper) -------------------------------------

export async function testClock(ctx: Ctx) {
  requireRole(ctx, "admin");
  requireFake(ctx, "the test clock");
  const userId = reqUuid(ctx.body, "userId");
  const ttlSeconds = optInt(ctx.body, "ttlSeconds", 60) ?? 3600;
  if (ttlSeconds > 86_400) throw new HttpError(400, "bad_request", "ttlSeconds must be <= 86400");
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  return {
    userId,
    token: await mintTestClockToken(userId, exp),
    expiresAt: new Date(exp * 1000).toISOString(),
  };
}
