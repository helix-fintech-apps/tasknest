// Tips, refunds (and their preview) and reviews.

import {
  addDays,
  clawbackPoints,
  MoneyPolicy,
  partsTotal,
  planRefund,
  RefundKind,
  RefundPlan,
  Tender,
  tipLimits,
  TipLimits,
  validateTip,
} from "../../_shared/domain/index.ts";
import {
  BookingRow,
  loadBooking,
  loadLots,
  loadMovements,
  loadPolicy,
  loadTenders,
  UnitOfWork,
  withLocks,
} from "../../_shared/db.ts";
import {
  HttpError,
  optInt,
  optString,
  pgToHttp,
  reqInt,
  reqString,
  UUID_RE,
} from "../../_shared/http.ts";
import { pointsIssueTxn, refundTxn, tipRefundTxn, tipTxn } from "../../_shared/postings.ts";
import { notify } from "../../_shared/notify.ts";
import { chargeTip } from "../../_shared/holds.ts";
import { PaymentError } from "../../_shared/provider/index.ts";
import * as pts from "../../_shared/points-store.ts";
import { bookingFigures, Ctx, requireParty } from "../context.ts";
import { bookingResponse, loadClientCard, onBooking, recordBalanceTxn } from "./bookings.ts";

// ---- POST /bookings/:id/tip ---------------------------------------------------------------------

interface TipCheckResult {
  amount: number;
  tender: Tender;
  tippedBefore: number;
  taskerGets: number;
  platformFee: number;
  limits: TipLimits;
}

/** The tip rules, shared by POST /tip and POST /tip-preview (the preview reports the first problem instead). */
async function checkTip(
  ctx: Ctx,
  b: BookingRow,
  policy: MoneyPolicy,
  amount: number,
  tender: Tender,
): Promise<TipCheckResult> {
  if (b.status !== "completed") {
    throw new HttpError(422, "rule_violation", "tips are allowed only after the task is completed");
  }
  const completedAt = b.completed_at ? new Date(b.completed_at) : null;
  const subtotal = Number(b.subtotal_cents);
  const check = validateTip(amount, tender, subtotal, completedAt, ctx.now, policy);
  // The cap applies to all tips on the booking together, not to each tip.
  const { data: prior, error } = await ctx.db
    .from("tips")
    .select("amount_cents")
    .eq("booking_id", b.id);
  if (error) throw pgToHttp(error);
  const tippedBefore = (prior ?? []).reduce((a, t) => a + Number(t.amount_cents), 0);
  if (tippedBefore > 0)
    validateTip(tippedBefore + amount, tender, subtotal, completedAt, ctx.now, policy);
  return {
    amount,
    tender,
    tippedBefore,
    taskerGets: check.taskerGets,
    platformFee: check.platformFee,
    limits: tipLimits(subtotal, tippedBefore, policy),
  };
}

export function tip(ctx: Ctx) {
  return onBooking(ctx, async (b) => {
    requireParty(ctx, b, "client");
    const amount = reqInt(ctx.body, "amountCents", 1);
    const tender = (optString(ctx.body, "tender") ?? "card") as Tender;
    const policy = await loadPolicy(ctx.db, b.policy_version);
    const c = await checkTip(ctx, b, policy, amount, tender);

    // The booking's saved card by default; the client may pick another saved card.
    const client = await loadClientCard(ctx.db, b.client_id);
    const moved = await chargeTip(ctx.provider, {
      amountCents: amount,
      bookingId: b.id,
      customerId: b.stripe_customer_id ?? client.customerId,
      paymentMethodId:
        optString(ctx.body, "paymentMethodId") ?? b.payment_method_id ?? client.defaultMethodId,
      legacyMethod: optString(ctx.body, "paymentMethod"),
      idempotencyKey: `${ctx.opKey}:tip`,
    });
    if (moved.status === "requires_action") {
      // A tip that needs 3DS has no pending state in the contract yet, so nothing is recorded and the client
      // is told to use another card. (Handed to WS4/WS3 in docs/contracts.md.)
      throw new PaymentError(
        "authentication_required",
        "Your bank needs you to approve this tip. Try another card.",
        402,
      );
    }
    const tipId = crypto.randomUUID();
    const uow = new UnitOfWork(ctx.idemKey ? ctx.opKey : undefined);
    uow.insert("tips", {
      id: tipId,
      booking_id: b.id,
      amount_cents: amount,
      platform_fee_cents: c.platformFee,
      stripe_payment_intent_id: moved.intentId,
      stripe_charge_id: moved.chargeId ?? null,
    });
    uow.insert("payment_intents", {
      id: moved.intentId,
      booking_id: b.id,
      kind: "tip",
      amount_cents: amount,
      status: "succeeded",
      charge_id: moved.chargeId ?? null,
      created_at: ctx.now.toISOString(),
    });
    recordBalanceTxn(uow, b.id, moved);
    uow.ledger(tipTxn(b.id, b.tasker_id, c.taskerGets), tipId);
    notify(uow, {
      userId: b.tasker_id,
      kind: "tip_received",
      bookingId: b.id,
      title: "You received a tip",
      body: "The whole tip is yours.",
    });
    await uow.commit(ctx.db);
    return {
      tip: {
        id: tipId,
        amountCents: amount,
        taskerGets: c.taskerGets,
        platformFee: c.platformFee,
        paymentIntentId: moved.intentId,
        tippedTotalCents: c.tippedBefore + amount,
      },
    };
  });
}

// ---- POST /bookings/:id/tip-preview (no side effects) --------------------------------------------------

export async function tipPreview(ctx: Ctx) {
  const b = await loadBooking(ctx.db, ctx.params.id);
  requireParty(ctx, b, "client");
  const policy = await loadPolicy(ctx.db, b.policy_version);
  const amount = optInt(ctx.body, "amountCents", 1);
  const { data: prior, error } = await ctx.db
    .from("tips")
    .select("amount_cents")
    .eq("booking_id", b.id);
  if (error) throw pgToHttp(error);
  const tippedBefore = (prior ?? []).reduce((a, t) => a + Number(t.amount_cents), 0);
  const limits = tipLimits(Number(b.subtotal_cents), tippedBefore, policy);
  let problem: string | undefined;
  if (b.status !== "completed") problem = "tips are allowed only after the task is completed";
  else if (amount !== undefined) {
    try {
      await checkTip(ctx, b, policy, amount, "card");
    } catch (e) {
      problem = e instanceof HttpError ? e.message : (e as Error).message;
    }
  }
  const completedAt = b.completed_at ? new Date(b.completed_at) : null;
  const client = await loadClientCard(ctx.db, b.client_id);
  return {
    capCents: limits.capCents,
    minCents: limits.minCents,
    alreadyTippedCents: limits.alreadyTippedCents,
    roomCents: limits.roomCents,
    windowEndsAt: completedAt ? addDays(completedAt, policy.tips.windowDays).toISOString() : null,
    paymentMethodId: b.payment_method_id ?? client.defaultMethodId,
    policyVersion: policy.version,
    ...(problem ? { problem } : {}),
  };
}

// ---- POST /bookings/:id/tips/:tipId/refund (support, admin) --------------------------------------------

// Tips are not part of what a client can ask to have refunded; staff can refund one in full. The whole tip
// comes back from the tasker (tips pass through 100%).
export function tipRefund(ctx: Ctx) {
  return onBooking(ctx, async (b) => {
    requireParty(ctx, b, "staff");
    const reason = reqString(ctx.body, "reason").trim();
    const { data: tipRow, error } = await ctx.db
      .from("tips")
      .select("*")
      .eq("id", ctx.params.tipId)
      .eq("booking_id", b.id)
      .maybeSingle();
    if (error) throw pgToHttp(error);
    if (!tipRow) throw new HttpError(404, "not_found", "tip not found");
    const left = Number(tipRow.amount_cents) - Number(tipRow.refunded_cents);
    if (left <= 0) throw new HttpError(409, "already_refunded", "this tip was already refunded");
    if (!tipRow.stripe_payment_intent_id)
      throw new HttpError(409, "provider_mismatch", "this tip has no card payment to refund");
    const refundId = await ctx.provider.refund(
      tipRow.stripe_payment_intent_id as string,
      left,
      `${ctx.opKey}:tip-refund`,
    );
    const uow = new UnitOfWork(ctx.idemKey ? ctx.opKey : undefined);
    uow.inc("tips", { id: tipRow.id }, "refunded_cents", left);
    uow.ledger(tipRefundTxn(b.id, b.tasker_id, left), tipRow.id);
    uow.audit(ctx.user.id, "tip_refunded", "booking", b.id, reason, {
      tipId: tipRow.id,
      amountCents: left,
      providerRefundId: refundId.id,
    });
    notify(uow, {
      userId: b.tasker_id,
      kind: "tip_refunded",
      bookingId: b.id,
      title: "A tip was refunded",
      body: reason,
    });
    await uow.commit(ctx.db);
    return {
      tip: {
        id: tipRow.id,
        amountCents: Number(tipRow.amount_cents),
        refundedCents: Number(tipRow.amount_cents),
      },
      refundedCents: left,
      providerRefundId: refundId.id,
    };
  });
}

// ---- Refund planning (shared by /refund and /refund-preview) -------------------------------------

interface RefundInput {
  kind: RefundKind;
  amountCents: number;
  reason: string;
  approvedBy?: string;
}

function readRefundInput(ctx: Ctx, refundable: number): RefundInput {
  const kind = reqString(ctx.body, "kind") as RefundKind;
  if (!["full", "partial", "goodwill"].includes(kind)) {
    throw new HttpError(400, "bad_request", "kind must be full, partial or goodwill");
  }
  const reason = typeof ctx.body.reason === "string" ? ctx.body.reason.trim() : "";
  const approvedBy = optString(ctx.body, "approvedBy")?.toLowerCase();
  // For "full" the UI sends the refundable amount; the domain refunds whatever is refundable.
  const amountCents =
    kind === "full" &&
    (ctx.body.amountCents === undefined ||
      ctx.body.amountCents === null ||
      ctx.body.amountCents === 0)
      ? Math.max(refundable, 1)
      : reqInt(ctx.body, "amountCents", 1);
  return { kind, amountCents, reason, approvedBy };
}

async function planFor(
  ctx: Ctx,
  b: BookingRow,
  input: RefundInput,
  policy: MoneyPolicy,
): Promise<RefundPlan> {
  if (!["completed", "no_show_client", "canceled_client"].includes(b.status)) {
    throw new HttpError(
      409,
      "illegal_state",
      `nothing captured to refund on a ${b.status} booking`,
    );
  }
  if (input.approvedBy) {
    if (!UUID_RE.test(input.approvedBy))
      throw new HttpError(400, "bad_request", "approvedBy must be a user id");
    const { data: approver } = await ctx.db
      .from("profiles")
      .select("role")
      .eq("id", input.approvedBy)
      .maybeSingle();
    if (approver?.role !== "admin")
      throw new HttpError(422, "rule_violation", "approvedBy must be an admin");
    if (input.approvedBy === ctx.user.id && ctx.user.role !== "admin") {
      throw new HttpError(422, "rule_violation", "cannot approve your own refund");
    }
  }
  const { paid, refunded } = await loadTenders(ctx.db, b.id);
  const { data: openDisputes, error: e1 } = await ctx.db
    .from("disputes")
    .select("id")
    .eq("booking_id", b.id)
    .in("status", ["needs_response", "under_review"]);
  if (e1) throw pgToHttp(e1);
  const { data: payouts, error: e2 } = await ctx.db
    .from("payouts")
    .select("id")
    .eq("tasker_id", b.tasker_id)
    .eq("status", "paid")
    .contains("booking_ids", [b.id]);
  if (e2) throw pgToHttp(e2);
  // Figures include extras charged at completion: the tasker's share is (labor + extra labor + expenses
  // - commission) / everything the client paid, i.e. the domain's proportional split.
  const f = bookingFigures(b, policy);
  return planRefund(
    {
      kind: input.kind,
      amountCents: input.amountCents,
      actor: ctx.user.role as "admin" | "support_agent",
      approvedBy: input.approvedBy,
      reason: input.reason,
      requestedAt: ctx.now,
    },
    {
      paid,
      alreadyRefunded: refunded,
      completedAt: b.completed_at ? new Date(b.completed_at) : null,
      subtotal: f.subtotal,
      total: f.total,
      taskerCommissionOnSubtotal: f.commission,
      taskerPaidOut: (payouts ?? []).length > 0,
      disputeOpen: (openDisputes ?? []).length > 0,
    },
    policy,
  );
}

// ---- POST /bookings/:id/refund-preview (no side effects) -------------------------------------------

export async function refundPreview(ctx: Ctx) {
  const b = await loadBooking(ctx.db, ctx.params.id);
  requireParty(ctx, b, "staff");
  const policy = await loadPolicy(ctx.db, b.policy_version);
  const { paid, refunded } = await loadTenders(ctx.db, b.id);
  const refundable = partsTotal(paid) - partsTotal(refunded);
  const input = readRefundInput(ctx, refundable);
  const plan = await planFor(ctx, b, input, policy);
  const target = clawbackPoints(b.points_earned, paid.card, refunded.card + plan.perTender.card);
  const claw = Math.max(0, target - pts.clawedBack(await loadMovements(ctx.db, b.id)));
  return {
    refundableCents: refundable,
    plan: { ...plan, amountCents: partsTotal(plan.perTender) },
    pointsReturned: plan.perTender.points / policy.points.centsPerPoint,
    pointsClawedBack: claw,
    policyVersion: policy.version,
  };
}

// ---- POST /bookings/:id/refund ----------------------------------------------------------------

export function refund(ctx: Ctx) {
  return onBooking(ctx, async (b) => {
    const who = requireParty(ctx, b, "client", "staff");
    const policy = await loadPolicy(ctx.db, b.policy_version);
    const { paid, refunded } = await loadTenders(ctx.db, b.id);
    const refundable = partsTotal(paid) - partsTotal(refunded);
    const input = readRefundInput(ctx, refundable);

    if (who === "client") {
      // Clients can only REQUEST a refund; support/admin decide.
      if (!input.reason) throw new HttpError(422, "rule_violation", "refund reason is required");
      const uow = new UnitOfWork();
      uow.audit(ctx.user.id, "refund_requested", "booking", b.id, input.reason, {
        kind: input.kind,
        amountCents: input.amountCents,
      });
      await uow.commit(ctx.db);
      return { requested: true, bookingId: b.id, kind: input.kind, amountCents: input.amountCents };
    }

    // Returned points and clawbacks touch the client's lots: serialize with their bookings.
    return withLocks(ctx.db, [`points:${b.client_id}`], async () => {
      const plan = await planFor(ctx, b, input, policy);
      const per = plan.perTender;
      const amount = partsTotal(per);
      const movs = await loadMovements(ctx.db, b.id);
      const lots = await loadLots(ctx.db, b.client_id);

      // Card money back through the provider: main PaymentIntent first (up to what was captured), then extras.
      const mainLeft =
        Number(b.captured_cents) -
        Math.min(Number(b.provider_refunded_cents), Number(b.captured_cents));
      const fromMain = Math.min(per.card, mainLeft);
      const fromExtra = per.card - fromMain;
      if (fromMain > 0 && !b.stripe_payment_intent_id) {
        throw new HttpError(409, "provider_mismatch", "booking has no captured card payment");
      }
      if (fromExtra > 0 && !b.extra_payment_intent_id) {
        throw new HttpError(
          409,
          "provider_mismatch",
          "card refund exceeds the captured card amount",
        );
      }

      // Plan every row before any money moves (returnPoints validates and can throw).
      const uow = new UnitOfWork(ctx.idemKey ? ctx.opKey : undefined);
      const refundId = crypto.randomUUID();
      for (const t of ["card", "points", "wallet", "promo"] as const) {
        // refund_le_paid check constraint enforces the per-tender cap in the database too.
        uow.inc("booking_tenders", { booking_id: b.id, tender: t }, "refunded_cents", per[t]);
      }
      if (per.card > 0) uow.inc("bookings", { id: b.id }, "provider_refunded_cents", per.card);
      const pointsBack = per.points / policy.points.centsPerPoint;
      pts.returnPoints(uow, b.client_id, b.id, movs, lots, pointsBack, ctx.now, policy);
      const target = clawbackPoints(b.points_earned, paid.card, refunded.card + per.card);
      const claw = Math.max(0, target - pts.clawedBack(movs));
      const clawResult = pts.clawback(uow, b.client_id, b.id, lots, claw, ctx.now);
      uow.insert("refunds", {
        id: refundId,
        booking_id: b.id,
        kind: input.kind,
        amount_cents: amount,
        per_tender: per,
        tasker_clawback_cents: plan.taskerClawbackCents,
        actor_id: ctx.user.id,
        actor_role: ctx.user.role,
        approved_by: input.approvedBy ?? null,
        reason: input.reason,
        idempotency_key: ctx.idemKey ? ctx.opKey : null,
      });
      uow.ledger(
        refundTxn(
          `refund_${input.kind}`,
          b.id,
          b.client_id,
          b.tasker_id,
          per,
          plan.taskerClawbackCents,
          pointsBack,
          claw,
          policy.points.centsPerPoint,
        ),
        refundId,
      );

      const providerRefunds: string[] = [];
      if (fromMain > 0) {
        providerRefunds.push(
          (
            await ctx.provider.refund(
              b.stripe_payment_intent_id!,
              fromMain,
              `${ctx.opKey}:refund:main`,
            )
          ).id,
        );
      }
      if (fromExtra > 0) {
        providerRefunds.push(
          (
            await ctx.provider.refund(
              b.extra_payment_intent_id!,
              fromExtra,
              `${ctx.opKey}:refund:extra`,
            )
          ).id,
        );
      }
      await uow.commit(ctx.db);
      return {
        refund: {
          id: refundId,
          kind: input.kind,
          amountCents: amount,
          perTender: per,
          taskerClawbackCents: plan.taskerClawbackCents,
          platformCostCents: plan.platformCostCents,
          requiresApproval: plan.requiresApproval,
          approvedBy: input.approvedBy ?? null,
          pointsReturned: pointsBack,
          pointsClawedBack: claw,
          pointsDebt: clawResult.debt,
          providerRefundIds: providerRefunds,
        },
        ...(await bookingResponse(ctx, b.id)),
      };
    });
  });
}

// ---- POST /bookings/:id/review -------------------------------------------------------------------

export function review(ctx: Ctx) {
  return onBooking(ctx, async (b) => {
    requireParty(ctx, b, "client");
    if (b.status !== "completed")
      throw new HttpError(409, "illegal_state", "only completed bookings can be reviewed");
    const rating = reqInt(ctx.body, "rating", 1);
    if (rating > 5) throw new HttpError(400, "bad_request", "rating must be 1..5");
    const body = typeof ctx.body.body === "string" ? ctx.body.body.trim() : "";
    if (body.length > 5000)
      throw new HttpError(400, "bad_request", "review is too long (max 5000)");
    const { data: existing } = await ctx.db
      .from("reviews")
      .select("booking_id")
      .eq("booking_id", b.id)
      .maybeSingle();
    if (existing) throw new HttpError(409, "already_reviewed", "this booking already has a review");
    const policy = await loadPolicy(ctx.db, b.policy_version);
    const uow = new UnitOfWork(ctx.idemKey ? ctx.opKey : undefined);
    uow.insert("reviews", { booking_id: b.id, rating, body });
    const bonusPoints = policy.points.reviewBonusPoints;
    if (bonusPoints > 0) {
      pts.bonus(uow, b.client_id, b.id, bonusPoints, ctx.now, policy);
      uow.ledger(
        pointsIssueTxn(
          "points_review_bonus",
          b.id,
          b.client_id,
          bonusPoints,
          policy.points.centsPerPoint,
        ),
      );
    }
    await uow.commit(ctx.db); // reviews PK (booking_id) makes the bonus once-only even under races
    return { review: { bookingId: b.id, rating, body }, bonusPoints };
  });
}
