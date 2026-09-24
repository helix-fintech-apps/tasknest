// Payouts, admin tasker status, policy publishing, dispute simulation and test-only helpers.

import {
  EarningItem,
  MoneyPolicy,
  partsTotal,
  planPayout,
  Tender,
} from "../../_shared/domain/index.ts";
import { loadBooking, loadPolicy, loadTenders, UnitOfWork, withLocks } from "../../_shared/db.ts";
import {
  HttpError,
  optInt,
  optString,
  pgToHttp,
  reqInt,
  reqString,
  reqUuid,
  toHttpError,
  UUID_RE,
  uuidFromKey,
} from "../../_shared/http.ts";
import { payoutTxn, pointsIssueTxn } from "../../_shared/postings.ts";
import { processStripeEvent } from "../../_shared/stripe-webhook.ts";
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

// ---- POST /payouts/run -------------------------------------------------------------------------

interface PayableLine {
  id: number;
  debit: number;
  credit: number;
  ledger_txns: { booking_id: string | null } | null;
}

async function payoutForTasker(
  ctx: Ctx,
  t: { id: string; status: string; stripe_account_id: string | null },
  policy: MoneyPolicy,
) {
  const { data: lines, error: e1 } = await ctx.db
    .from("ledger_lines")
    .select("id, debit, credit, ledger_txns!inner(booking_id)")
    .eq("account", "tasker_payable")
    .eq("party", t.id)
    .eq("unit", "USD");
  if (e1) throw pgToHttp(e1);
  const { data: paidRows, error: e2 } = await ctx.db
    .from("payouts")
    .select("booking_ids")
    .eq("tasker_id", t.id)
    .eq("status", "paid");
  if (e2) throw pgToHttp(e2);
  const paidOut = new Set<string>((paidRows ?? []).flatMap((p) => p.booking_ids as string[]));

  let balance = 0;
  let lastLineId = 0;
  const netByBooking = new Map<string, number>();
  for (const l of (lines ?? []) as unknown as PayableLine[]) {
    const net = Number(l.credit) - Number(l.debit);
    balance += net;
    lastLineId = Math.max(lastLineId, Number(l.id));
    const bid = l.ledger_txns?.booking_id ?? null;
    if (bid) netByBooking.set(bid, (netByBooking.get(bid) ?? 0) + net);
  }
  const unpaidIds = [...netByBooking.keys()].filter((id) => !paidOut.has(id));
  const items: EarningItem[] = [];
  if (unpaidIds.length > 0) {
    const { data: bks, error: e3 } = await ctx.db
      .from("bookings")
      .select("id, status, completed_at, canceled_at, created_at")
      .in("id", unpaidIds);
    if (e3) throw pgToHttp(e3);
    for (const bk of bks ?? []) {
      items.push({
        bookingId: bk.id,
        netCents: netByBooking.get(bk.id) ?? 0,
        completedAt: new Date(bk.completed_at ?? bk.canceled_at ?? bk.created_at),
        cardSettled: bk.status !== "disputed",
        paidOut: false,
      });
    }
  }
  // Everything not attributable to an unpaid booking (earlier payouts, clawbacks/disputes on
  // bookings already paid out) is a balance adjustment; negative adjustments block the payout.
  const unpaidNet = items.reduce((a, i) => a + i.netCents, 0);
  const adjustments = balance - unpaidNet;
  const plan = planPayout(items, adjustments, t.status, ctx.now, policy);
  if (plan.amountCents <= 0) {
    return {
      taskerId: t.id,
      amountCents: 0,
      balanceCents: balance,
      blockedReason: plan.blockedReason ?? "nothing eligible",
    };
  }
  if (!t.stripe_account_id) {
    return {
      taskerId: t.id,
      amountCents: 0,
      balanceCents: balance,
      blockedReason: "no payout account (KYC incomplete)",
    };
  }
  // Same ledger state => same payout id and transfer idempotency key, so a retried run can't pay twice.
  const bookingIds = [...plan.bookingIds].sort();
  const payoutId = await uuidFromKey(
    `payout:${t.id}:${plan.amountCents}:${lastLineId}:${bookingIds.join(",")}`,
  );
  const tr = await ctx.provider.transfer({
    amountCents: plan.amountCents,
    destination: t.stripe_account_id,
    payoutId,
    idempotencyKey: `payout:${payoutId}`,
  });
  const uow = new UnitOfWork(`payout:${payoutId}`);
  uow.insert("payouts", {
    id: payoutId,
    tasker_id: t.id,
    amount_cents: plan.amountCents,
    booking_ids: bookingIds,
    stripe_transfer_id: tr.id,
    status: "paid",
  });
  uow.ledger(payoutTxn(t.id, plan.amountCents), payoutId);
  uow.audit(ctx.user.id, "payout", "tasker", t.id, undefined, {
    payoutId,
    amountCents: plan.amountCents,
    bookingIds,
  });
  try {
    await uow.commit(ctx.db);
  } catch (e) {
    if (toHttpError(e).code !== "duplicate") throw e;
  }
  return {
    taskerId: t.id,
    payoutId,
    amountCents: plan.amountCents,
    bookingIds,
    transferId: tr.id,
    balanceCents: balance - plan.amountCents,
  };
}

export async function runPayouts(ctx: Ctx) {
  requireRole(ctx, "admin");
  const only = optString(ctx.body, "taskerId");
  if (only && !UUID_RE.test(only))
    throw new HttpError(400, "bad_request", "taskerId must be a uuid");
  const policy = await loadPolicy(ctx.db, undefined, ctx.now);
  let q = ctx.db.from("taskers").select("id, status, stripe_account_id").order("id");
  if (only) q = q.eq("id", only.toLowerCase());
  const { data: taskers, error } = await q;
  if (error) throw pgToHttp(error);
  if (only && (taskers ?? []).length === 0)
    throw new HttpError(404, "not_found", "tasker not found");

  const results = [];
  for (const t of taskers ?? []) {
    // One payout computation at a time per tasker (the lease spans the transfer and the ledger write).
    results.push(
      await withLocks(ctx.db, [`payout:${t.id}`], () => payoutForTasker(ctx, t, policy)),
    );
  }
  return { payouts: results };
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
