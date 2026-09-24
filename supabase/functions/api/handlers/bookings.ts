// Quote, booking creation and the booking lifecycle (accept/decline/reschedule/start/complete/cancel/no-show).
//
// Pattern for every money operation: take the lease(s) -> load fresh state -> validate and plan with the
// shared domain code -> call the payment provider -> commit ALL rows + ledger txns in one tn_apply
// transaction. Nothing that can fail on business rules runs after a provider call.

import {
  addDays,
  allocateTenders,
  applyBps,
  BookingMoney,
  CancellationOutcome,
  clientCancellation,
  clientNoShow,
  consumeFifo,
  emptyParts,
  localToUtc,
  MoneyPolicy,
  needsReauth,
  partsTotal,
  pointsEarned,
  promoDiscount,
  PromoCode,
  quote,
  refundAfterRetention,
  shouldSuspend,
  taskerCancellation,
  TenderParts,
} from "../../_shared/domain/index.ts";
import {
  BookingRow,
  loadBooking,
  loadLots,
  loadMovements,
  loadPolicy,
  loadTenders,
  lotsForDomain,
  must,
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
  reqUuid,
} from "../../_shared/http.ts";
import {
  captureTxn,
  extrasTxn,
  holdTxn,
  pointsIssueTxn,
  releaseHoldTxn,
  taskerPenaltyTxn,
} from "../../_shared/postings.ts";
import * as pts from "../../_shared/points-store.ts";
import { bookingFigures, Ctx, requireParty, requireRole, transition } from "../context.ts";

const ACTIVE = ["requested", "accepted", "in_progress"];
const LOCAL_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

/** "YYYY-MM-DDTHH:mm" that names a real calendar date and time (no 2026-02-30 or 25:00 rollover). */
function checkLocalStart(localStart: string): void {
  const bad = () =>
    new HttpError(400, "bad_request", "localStart must be a valid YYYY-MM-DDTHH:mm");
  if (!LOCAL_RE.test(localStart)) throw bad();
  const [y, mo, d, h, mi] = localStart.split(/[-T:]/).map(Number);
  const u = new Date(Date.UTC(y, mo - 1, d, h, mi));
  const same =
    u.getUTCFullYear() === y &&
    u.getUTCMonth() === mo - 1 &&
    u.getUTCDate() === d &&
    u.getUTCHours() === h &&
    u.getUTCMinutes() === mi;
  if (!same) throw bad();
}

export async function bookingResponse(ctx: Ctx, id: string, extra: Record<string, unknown> = {}) {
  const booking = await loadBooking(ctx.db, id);
  const { rows } = await loadTenders(ctx.db, id);
  return { booking, tenders: rows, ...extra };
}

/** Serialize every write on one booking (all instances of the function). Load the booking inside. */
export function onBooking<T>(ctx: Ctx, fn: (b: BookingRow) => Promise<T>): Promise<T> {
  return withLocks(ctx.db, [`booking:${ctx.params.id}`], async () =>
    fn(await loadBooking(ctx.db, ctx.params.id)),
  );
}

async function loadActiveTasker(ctx: Ctx, taskerId: string) {
  const t = must(
    await ctx.db
      .from("taskers")
      .select("id, status, hourly_rate_cents, stripe_account_id")
      .eq("id", taskerId)
      .maybeSingle(),
    "tasker",
  );
  if (t.status !== "active")
    throw new HttpError(409, "tasker_unavailable", `tasker is ${t.status}`);
  return t as {
    id: string;
    status: string;
    hourly_rate_cents: number;
    stripe_account_id: string | null;
  };
}

async function promoFor(ctx: Ctx, code: string | undefined, subtotal: number): Promise<number> {
  if (!code) return 0;
  const row = must(
    await ctx.db.from("promo_codes").select("*").eq("code", code.toUpperCase()).maybeSingle(),
    "promo code",
  );
  const { data: used } = await ctx.db
    .from("promo_redemptions")
    .select("code")
    .eq("code", row.code)
    .eq("user_id", ctx.user.id)
    .maybeSingle();
  const { count } = await ctx.db
    .from("bookings")
    .select("id", { count: "exact", head: true })
    .eq("client_id", ctx.user.id)
    .not("status", "in", "(declined,canceled_client,canceled_tasker)");
  const p: PromoCode = {
    code: row.code,
    kind: row.kind,
    value: row.value,
    firstTaskOnly: row.first_task_only,
    maxDiscountCents: row.max_discount_cents ?? undefined,
    expiresAt: row.expires_at ? new Date(row.expires_at) : undefined,
  };
  return promoDiscount(p, subtotal, (count ?? 0) === 0, !!used, ctx.now);
}

// ---- POST /quote ------------------------------------------------------------------------------

export async function quoteHandler(ctx: Ctx) {
  const b = ctx.body;
  const taskerId = reqUuid(b, "taskerId");
  const minutes = reqInt(b, "minutes", 1);
  if (minutes > 24 * 60) throw new HttpError(400, "bad_request", "minutes must be <= 1440");
  const promoCode = optString(b, "promoCode");
  const pointsRequested = optInt(b, "pointsRequested") ?? 0;
  const tasker = await loadActiveTasker(ctx, taskerId);
  const policy = await loadPolicy(ctx.db, undefined, ctx.now);
  const q = quote(Number(tasker.hourly_rate_cents), minutes, policy);
  const discountCents = await promoFor(ctx, promoCode, q.subtotal);
  const lots = lotsForDomain(await loadLots(ctx.db, ctx.user.id), ctx.now);
  const allocation = allocateTenders(
    q.total,
    {
      promoCents: discountCents,
      walletCents: 0,
      pointsBalance: lots.availableNet,
      pointsRequested,
    },
    policy,
  );
  return {
    quote: q,
    allocation,
    discountCents,
    promoCode: promoCode?.toUpperCase() ?? null,
    policyVersion: policy.version,
    points: { available: lots.availableNet, pending: lots.pending },
  };
}

// ---- POST /bookings ----------------------------------------------------------------------------

export async function createBooking(ctx: Ctx) {
  requireRole(ctx, "client");
  if (!ctx.user.emailConfirmed)
    throw new HttpError(403, "unverified", "verify your email before booking");
  const b = ctx.body;
  const taskerId = reqUuid(b, "taskerId");
  const localStart = reqString(b, "localStart");
  const tz = reqString(b, "tz");
  const minutes = reqInt(b, "minutes", 1);
  if (minutes > 24 * 60) throw new HttpError(400, "bad_request", "minutes must be <= 1440");
  const description = typeof b.description === "string" ? b.description.trim() : "";
  if (description.length > 2000)
    throw new HttpError(400, "bad_request", "description is too long (max 2000)");
  const promoCode = optString(b, "promoCode")?.toUpperCase();
  const pointsRequested = optInt(b, "pointsRequested") ?? 0;
  const paymentMethod = optString(b, "paymentMethod");
  checkLocalStart(localStart);
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
  } catch {
    throw new HttpError(400, "bad_request", `unknown time zone ${tz}`);
  }
  if (taskerId === ctx.user.id) throw new HttpError(422, "rule_violation", "cannot book yourself");

  const startAt = localToUtc(localStart, tz);
  if (Number.isNaN(startAt.getTime()))
    throw new HttpError(400, "bad_request", "localStart is not a valid date");
  if (startAt <= ctx.now)
    throw new HttpError(422, "rule_violation", "start time must be in the future");

  // Spending points: one booking at a time per client, so the balance check and the reservation agree.
  const locks = pointsRequested > 0 ? [`points:${ctx.user.id}`] : [];
  return withLocks(ctx.db, locks, async () => {
    const tasker = await loadActiveTasker(ctx, taskerId);
    const policy = await loadPolicy(ctx.db, undefined, ctx.now);
    const q = quote(Number(tasker.hourly_rate_cents), minutes, policy);
    const discountCents = await promoFor(ctx, promoCode, q.subtotal);
    const lots = lotsForDomain(await loadLots(ctx.db, ctx.user.id), ctx.now);
    const alloc = allocateTenders(
      q.total,
      {
        promoCents: discountCents,
        walletCents: 0,
        pointsBalance: lots.availableNet,
        pointsRequested,
      },
      policy,
    );
    const pointsUsed = alloc.pointsUsed;
    const takes = pointsUsed > 0 ? consumeFifo(lots.lots, pointsUsed, ctx.now) : [];

    // Quick pre-check (the unit of work re-checks under a per-tasker lock inside the transaction).
    const { data: clash } = await ctx.db
      .from("bookings")
      .select("id, start_at, est_minutes")
      .eq("tasker_id", taskerId)
      .in("status", ACTIVE)
      .lt("start_at", new Date(startAt.getTime() + minutes * 60_000).toISOString())
      .gte("start_at", new Date(startAt.getTime() - 24 * 3_600_000).toISOString());
    for (const c of clash ?? []) {
      const s = new Date(c.start_at).getTime();
      if (s + c.est_minutes * 60_000 > startAt.getTime()) {
        throw new HttpError(409, "slot_taken", "tasker already has a booking in that time slot");
      }
    }

    const bookingId = crypto.randomUUID();
    let pi: { id: string } | null = null;
    if (alloc.parts.card > 0) {
      pi = await ctx.provider.authorize({
        amountCents: alloc.parts.card,
        bookingId,
        description: `TaskNest booking ${bookingId}`,
        paymentMethod,
        idempotencyKey: `${ctx.opKey}:auth`,
      });
    }
    const authExpires = pi ? addDays(ctx.now, policy.auth.validityDays) : null;

    const uow = new UnitOfWork(ctx.idemKey ? ctx.opKey : undefined);
    uow.assertSlotFree(taskerId, startAt, minutes);
    uow.insert("bookings", {
      id: bookingId,
      client_id: ctx.user.id,
      tasker_id: taskerId,
      policy_version: policy.version,
      status: "requested",
      description,
      location_tz: tz,
      start_at: startAt.toISOString(),
      original_start_at: startAt.toISOString(),
      est_minutes: minutes,
      rate_cents: tasker.hourly_rate_cents,
      subtotal_cents: q.subtotal,
      service_fee_cents: q.serviceFee,
      tax_cents: q.tax,
      total_cents: q.total,
      points_reserved: pointsUsed,
      promo_code: alloc.parts.promo > 0 ? promoCode : null,
      stripe_payment_intent_id: pi?.id ?? null,
      auth_expires_at: authExpires?.toISOString() ?? null,
      created_at: ctx.now.toISOString(),
    });
    const tenderRows = [
      { booking_id: bookingId, tender: "card", amount_cents: alloc.parts.card, points: 0 },
    ];
    if (alloc.parts.points > 0) {
      tenderRows.push({
        booking_id: bookingId,
        tender: "points",
        amount_cents: alloc.parts.points,
        points: pointsUsed,
      });
    }
    if (alloc.parts.promo > 0) {
      tenderRows.push({
        booking_id: bookingId,
        tender: "promo",
        amount_cents: alloc.parts.promo,
        points: 0,
      });
    }
    if (alloc.parts.wallet > 0) {
      tenderRows.push({
        booking_id: bookingId,
        tender: "wallet",
        amount_cents: alloc.parts.wallet,
        points: 0,
      });
    }
    uow.insert("booking_tenders", tenderRows);
    pts.reserve(uow, ctx.user.id, bookingId, takes);
    if (alloc.parts.promo > 0 && promoCode) {
      uow.insert("promo_redemptions", {
        code: promoCode,
        user_id: ctx.user.id,
        booking_id: bookingId,
        discount_cents: alloc.parts.promo,
      });
    }
    uow.ledger(holdTxn(bookingId, ctx.user.id, alloc.parts, pointsUsed));
    try {
      await uow.commit(ctx.db);
    } catch (e) {
      if (pi) await ctx.provider.cancel(pi.id, `${ctx.opKey}:auth:void`).catch(() => {});
      throw e;
    }
    return bookingResponse(ctx, bookingId, {
      quote: q,
      allocation: alloc,
      discountCents,
      policyVersion: policy.version,
      needsReauth: needsReauth(
        ctx.now,
        startAt,
        policy.auth.validityDays,
        policy.auth.reauthBufferDays,
      ),
    });
  });
}

// ---- Shared money helpers ------------------------------------------------------------------------

function bookingMoney(b: BookingRow): BookingMoney {
  return {
    rateCents: Number(b.rate_cents),
    subtotal: Number(b.subtotal_cents),
    serviceFee: Number(b.service_fee_cents),
    tax: Number(b.tax_cents),
    total: Number(b.total_cents),
    cutoffAnchorAt: new Date(b.original_start_at),
  };
}

function pointsOf(cents: number, policy: MoneyPolicy): number {
  if (cents % policy.points.centsPerPoint !== 0) {
    throw new Error(`points tender ${cents} is not a whole number of points`);
  }
  return cents / policy.points.centsPerPoint;
}

const nonCardParts = (p: TenderParts): TenderParts => ({
  card: 0,
  points: p.points,
  wallet: p.wallet,
  promo: p.promo,
});

function setTenderRefunds(
  uow: UnitOfWork,
  bookingId: string,
  paid: TenderParts,
  refund: TenderParts,
) {
  for (const t of ["card", "points", "wallet", "promo"] as const) {
    if (paid[t] > 0 || t === "card") {
      uow.update(
        "booking_tenders",
        { booking_id: bookingId, tender: t },
        { refunded_cents: refund[t] },
        -1,
      );
    }
  }
}

/**
 * Client cancellation / client no-show: keep `outcome.retainedCents` (taken from tenders in retention
 * order), capture the kept card amount, redeem kept points, release the rest, refund everything else.
 */
async function retainAndRefund(
  ctx: Ctx,
  b: BookingRow,
  policy: MoneyPolicy,
  outcome: CancellationOutcome,
  toStatus: "canceled_client" | "no_show_client",
  reason: string,
) {
  const { paid } = await loadTenders(ctx.db, b.id);
  const { kept, refund } = refundAfterRetention(paid, outcome.retainedCents, policy);
  const movs = await loadMovements(ctx.db, b.id);
  const lots = await loadLots(ctx.db, b.client_id);
  const held = pts.reservedByLot(movs);
  const keptPoints = pointsOf(kept.points, policy);
  const refundPoints = pointsOf(refund.points, policy);
  const refundTotal = partsTotal(refund);

  // Plan everything before any money moves.
  const uow = new UnitOfWork(ctx.idemKey ? ctx.opKey : undefined);
  uow.update(
    "bookings",
    { id: b.id, status: b.status },
    { status: toStatus, canceled_at: ctx.now.toISOString(), captured_cents: kept.card },
  );
  setTenderRefunds(uow, b.id, paid, refund);
  const redeemed = pts.redeem(uow, b.client_id, b.id, held, keptPoints);
  const released = pts.release(uow, b.client_id, b.id, held, refundPoints, lots, ctx.now, policy);
  if (redeemed !== keptPoints || released !== refundPoints) {
    throw new HttpError(
      500,
      "points_mismatch",
      `booking holds ${b.points_reserved} points, plan needs ${keptPoints}+${refundPoints}`,
    );
  }
  if (kept.promo === 0 && b.promo_code)
    uow.delete("promo_redemptions", { code: b.promo_code, user_id: b.client_id });
  if (refundTotal > 0) {
    uow.insert("refunds", {
      booking_id: b.id,
      kind: "cancellation",
      amount_cents: refundTotal,
      per_tender: refund,
      tasker_clawback_cents: 0,
      actor_id: ctx.user.id,
      actor_role: ctx.user.role,
      reason,
      idempotency_key: ctx.idemKey ? `${ctx.opKey}:refund` : null,
    });
  }
  const kind = toStatus === "canceled_client" ? "cancellation_fee" : "no_show_fee";
  uow.ledger(
    captureTxn(
      kind,
      b.id,
      b.client_id,
      b.tasker_id,
      kept.card,
      kept.points + kept.wallet + kept.promo,
      {
        taskerPay: outcome.taskerPayCents,
        platform: outcome.platformCents,
        tax: 0,
      },
    ),
  );
  uow.ledger(releaseHoldTxn(b.id, b.client_id, nonCardParts(refund), refundPoints));
  uow.audit(ctx.user.id, toStatus, "booking", b.id, reason, { outcome, kept, refund });

  // Money: capture what we keep (the rest of the authorization is released by the provider).
  if (kept.card > 0) {
    if (!b.stripe_payment_intent_id)
      throw new HttpError(409, "provider_mismatch", "booking has no card authorization");
    await ctx.provider.capture(b.stripe_payment_intent_id, kept.card, `${b.id}:capture`);
  }
  await uow.commit(ctx.db);
  if (kept.card === 0 && b.stripe_payment_intent_id) {
    await ctx.provider.cancel(b.stripe_payment_intent_id, `${b.id}:cancel`).catch(() => {});
  }
  return bookingResponse(ctx, b.id, {
    outcome,
    refund: {
      refundCents: refundTotal,
      retainedCents: outcome.retainedCents,
      perTender: refund,
      kept,
    },
  });
}

/** Tasker cancel / tasker no-show / decline: client gets everything back. Cancel/no-show add a strike + fee. */
async function providerFault(
  ctx: Ctx,
  b: BookingRow,
  policy: MoneyPolicy,
  toStatus: "declined" | "canceled_tasker" | "no_show_tasker",
  reason: string,
) {
  const { paid } = await loadTenders(ctx.db, b.id);
  const movs = await loadMovements(ctx.db, b.id);
  const lots = await loadLots(ctx.db, b.client_id);
  const held = pts.reservedByLot(movs);
  const outcome = taskerCancellation(bookingMoney(b), policy);
  const pointsBack = pointsOf(paid.points, policy);

  const run = async () => {
    const uow = new UnitOfWork(ctx.idemKey ? ctx.opKey : undefined);
    uow.update(
      "bookings",
      { id: b.id, status: b.status },
      { status: toStatus, canceled_at: ctx.now.toISOString() },
    );
    setTenderRefunds(uow, b.id, paid, paid);
    const released = pts.release(uow, b.client_id, b.id, held, pointsBack, lots, ctx.now, policy);
    if (released !== pointsBack) {
      throw new HttpError(
        500,
        "points_mismatch",
        `released ${released} of ${pointsBack} held points`,
      );
    }
    if (b.promo_code) uow.delete("promo_redemptions", { code: b.promo_code, user_id: b.client_id });
    uow.ledger(releaseHoldTxn(b.id, b.client_id, nonCardParts(paid), pointsBack));
    let suspended = false;
    let strikeCount = 0;
    if (toStatus !== "declined") {
      uow.insert("refunds", {
        booking_id: b.id,
        kind: "cancellation",
        amount_cents: outcome.refundCents,
        per_tender: paid,
        tasker_clawback_cents: 0,
        actor_id: ctx.user.id,
        actor_role: ctx.user.role,
        reason,
        idempotency_key: ctx.idemKey ? `${ctx.opKey}:refund` : null,
      });
      const fee = outcome.taskerFeeCents;
      uow.insert("tasker_strikes", {
        tasker_id: b.tasker_id,
        booking_id: b.id,
        reason: `${toStatus}: ${reason}`,
        fee_cents: fee,
        created_at: ctx.now.toISOString(),
      });
      if (fee > 0) uow.ledger(taskerPenaltyTxn(b.id, b.tasker_id, fee));
      const since = addDays(ctx.now, -policy.taskerPenalty.strikeWindowDays).toISOString();
      const { data: strikes, error } = await ctx.db
        .from("tasker_strikes")
        .select("created_at")
        .eq("tasker_id", b.tasker_id)
        .gte("created_at", since)
        .lte("created_at", ctx.now.toISOString());
      if (error) throw pgToHttp(error);
      const times = [...(strikes ?? []).map((s) => new Date(s.created_at)), ctx.now];
      strikeCount = times.length;
      if (shouldSuspend(times, ctx.now, policy)) {
        suspended = true;
        uow.update(
          "taskers",
          { id: b.tasker_id, status: "active" },
          { status: "suspended", suspended_at: ctx.now.toISOString() },
          -1,
        );
        uow.audit(
          null,
          "tasker_suspended",
          "tasker",
          b.tasker_id,
          `${strikeCount} strikes in ${policy.taskerPenalty.strikeWindowDays} days`,
        );
      }
    }
    uow.audit(ctx.user.id, toStatus, "booking", b.id, reason);
    await uow.commit(ctx.db);
    return { suspended, strikeCount };
  };
  // Strikes are counted per tasker: serialize strike-bearing operations for the same tasker.
  const { suspended, strikeCount } =
    toStatus === "declined" ? await run() : await withLocks(ctx.db, [`tasker:${b.tasker_id}`], run);
  if (b.stripe_payment_intent_id) {
    await ctx.provider.cancel(b.stripe_payment_intent_id, `${b.id}:cancel`).catch(() => {});
  }
  return bookingResponse(ctx, b.id, {
    outcome,
    refund: { refundCents: partsTotal(paid), retainedCents: 0, perTender: paid },
    strike:
      toStatus === "declined"
        ? null
        : { feeCents: outcome.taskerFeeCents, strikesInWindow: strikeCount, suspended },
  });
}

// ---- Lifecycle endpoints ----------------------------------------------------------------------------

export function accept(ctx: Ctx) {
  return onBooking(ctx, async (b) => {
    requireParty(ctx, b, "tasker");
    transition(b, "accepted");
    const policy = await loadPolicy(ctx.db, b.policy_version);
    const deadline = new Date(
      new Date(b.created_at).getTime() + policy.booking.taskerResponseHours * 3_600_000,
    );
    if (ctx.now > deadline) {
      throw new HttpError(
        409,
        "response_window_expired",
        "the response window has passed; the booking can only be declined",
      );
    }
    const { data: t } = await ctx.db
      .from("taskers")
      .select("status")
      .eq("id", b.tasker_id)
      .single();
    if (t?.status !== "active")
      throw new HttpError(409, "tasker_unavailable", `tasker is ${t?.status}`);
    const uow = new UnitOfWork();
    uow.update(
      "bookings",
      { id: b.id, status: "requested" },
      { status: "accepted", accepted_at: ctx.now.toISOString() },
    );
    await uow.commit(ctx.db);
    return bookingResponse(ctx, b.id);
  });
}

export function decline(ctx: Ctx) {
  return onBooking(ctx, async (b) => {
    requireParty(ctx, b, "tasker", "admin");
    transition(b, "declined");
    const policy = await loadPolicy(ctx.db, b.policy_version);
    return providerFault(ctx, b, policy, "declined", optString(ctx.body, "reason") ?? "declined");
  });
}

export function reschedule(ctx: Ctx) {
  return onBooking(ctx, async (b) => {
    requireParty(ctx, b, "client", "tasker");
    if (b.status !== "requested" && b.status !== "accepted") {
      throw new HttpError(409, "illegal_state", `cannot reschedule a ${b.status} booking`);
    }
    const localStart = reqString(ctx.body, "localStart");
    checkLocalStart(localStart);
    const startAt = localToUtc(localStart, b.location_tz);
    if (Number.isNaN(startAt.getTime()))
      throw new HttpError(400, "bad_request", "localStart is not a valid date");
    if (startAt <= ctx.now)
      throw new HttpError(422, "rule_violation", "start time must be in the future");
    const uow = new UnitOfWork();
    uow.assertSlotFree(b.tasker_id, startAt, b.est_minutes, b.id);
    // original_start_at is deliberately NOT changed: the cancellation cutoff stays anchored to it.
    uow.update("bookings", { id: b.id, status: b.status }, { start_at: startAt.toISOString() });
    uow.audit(ctx.user.id, "rescheduled", "booking", b.id, undefined, {
      from: b.start_at,
      to: startAt.toISOString(),
    });
    await uow.commit(ctx.db);
    return bookingResponse(ctx, b.id);
  });
}

export function start(ctx: Ctx) {
  return onBooking(ctx, async (b) => {
    requireParty(ctx, b, "tasker");
    transition(b, "in_progress");
    const uow = new UnitOfWork();
    uow.update(
      "bookings",
      { id: b.id, status: "accepted" },
      { status: "in_progress", started_at: ctx.now.toISOString() },
    );
    await uow.commit(ctx.db);
    return bookingResponse(ctx, b.id);
  });
}

export function complete(ctx: Ctx) {
  return onBooking(ctx, async (b) => {
    requireParty(ctx, b, "tasker");
    if (b.status !== "in_progress")
      throw new HttpError(
        409,
        "illegal_state",
        `cannot complete a ${b.status} booking; start it first`,
      );
    transition(b, "completed");
    const extraMinutes = optInt(ctx.body, "extraMinutes") ?? 0;
    const expensesCents = optInt(ctx.body, "expensesCents") ?? 0;
    if (extraMinutes > 24 * 60)
      throw new HttpError(400, "bad_request", "extraMinutes must be <= 1440");
    if (expensesCents > 1_000_000)
      throw new HttpError(400, "bad_request", "expensesCents must be <= 1000000");
    const policy = await loadPolicy(ctx.db, b.policy_version);
    const { paid } = await loadTenders(ctx.db, b.id);
    const movs = await loadMovements(ctx.db, b.id);
    const held = pts.reservedByLot(movs);

    const xq = extraMinutes > 0 ? quote(Number(b.rate_cents), extraMinutes, policy) : null;
    const extraLabor = xq?.subtotal ?? 0;
    const extraFee = xq?.serviceFee ?? 0;
    const extraTax = xq?.tax ?? 0;
    const extraTotal = extraLabor + extraFee + extraTax + expensesCents;
    const cardPaid = paid.card + extraTotal;
    const earned = pointsEarned(
      cardPaid,
      Number(b.tax_cents) + extraTax,
      Number(b.total_cents) + extraTotal,
      policy,
    );
    const commission = applyBps(Number(b.subtotal_cents), policy.taskerCommissionBps);
    const xCommission = applyBps(extraLabor, policy.taskerCommissionBps);

    // Plan and validate everything before any money moves.
    const uow = new UnitOfWork(ctx.idemKey ? ctx.opKey : undefined);
    const redeemed = pts.redeem(uow, b.client_id, b.id, held, b.points_reserved);
    if (redeemed !== pointsOf(paid.points, policy)) {
      throw new HttpError(
        500,
        "points_mismatch",
        `reserved ${redeemed} points but tender says ${paid.points}`,
      );
    }
    const capture = captureTxn(
      "booking_completed",
      b.id,
      b.client_id,
      b.tasker_id,
      paid.card,
      paid.points + paid.wallet + paid.promo,
      {
        taskerPay: Number(b.subtotal_cents) - commission,
        platform: Number(b.service_fee_cents) + commission,
        tax: Number(b.tax_cents),
      },
    );
    const extras =
      extraTotal > 0
        ? extrasTxn(b.id, b.tasker_id, {
            card: extraTotal,
            taskerPay: extraLabor - xCommission + expensesCents,
            platform: extraFee + xCommission,
            tax: extraTax,
          })
        : null;

    // Capture the card (never more than was authorized). Expired authorizations are charged again.
    let piId = b.stripe_payment_intent_id;
    if (paid.card > 0) {
      const expired = b.auth_expires_at && ctx.now > new Date(b.auth_expires_at);
      if (expired || !piId) {
        const r = await ctx.provider.charge({
          amountCents: paid.card,
          bookingId: b.id,
          description: `TaskNest booking ${b.id} (re-authorized)`,
          idempotencyKey: `${b.id}:reauth`,
          kind: "reauth",
        });
        piId = r.id;
      } else {
        await ctx.provider.capture(piId, paid.card, `${b.id}:capture`);
      }
    }
    // Extras are a separate charge.
    let extraPi: string | null = null;
    if (extraTotal > 0) {
      extraPi = (
        await ctx.provider.charge({
          amountCents: extraTotal,
          bookingId: b.id,
          description: `TaskNest extras ${b.id}`,
          idempotencyKey: `${b.id}:extras`,
          kind: "extras",
        })
      ).id;
    }

    uow.update(
      "bookings",
      { id: b.id, status: "in_progress" },
      {
        status: "completed",
        completed_at: ctx.now.toISOString(),
        captured_cents: paid.card,
        stripe_payment_intent_id: piId,
        extra_cents: extraTotal,
        extra_labor_cents: extraLabor,
        extra_service_fee_cents: extraFee,
        extra_tax_cents: extraTax,
        expenses_cents: expensesCents,
        extra_payment_intent_id: extraPi,
        points_earned: earned,
      },
    );
    if (extraTotal > 0)
      uow.inc("booking_tenders", { booking_id: b.id, tender: "card" }, "amount_cents", extraTotal);
    uow.ledger(capture);
    uow.ledger(extras);
    if (earned > 0) {
      pts.earn(uow, b.client_id, b.id, earned, ctx.now, policy);
      uow.ledger(
        pointsIssueTxn("points_earned", b.id, b.client_id, earned, policy.points.centsPerPoint),
      );
    }
    await uow.commit(ctx.db);
    return bookingResponse(ctx, b.id, {
      captured: { cardCents: paid.card, extrasCents: extraTotal, pointsRedeemed: redeemed },
      pointsEarned: earned,
    });
  });
}

// ---- Cancel / no-show ---------------------------------------------------------------------------------

export async function cancelPreview(ctx: Ctx) {
  const b = await loadBooking(ctx.db, ctx.params.id);
  const who = requireParty(ctx, b, "client", "tasker", "staff");
  const policy = await loadPolicy(ctx.db, b.policy_version);
  const { paid } = await loadTenders(ctx.db, b.id);
  if (who === "tasker") {
    const o = taskerCancellation(bookingMoney(b), policy);
    return {
      who,
      policyVersion: policy.version,
      outcome: o,
      refund: {
        refundCents: partsTotal(paid),
        retainedCents: 0,
        perTender: paid,
        kept: emptyParts(),
      },
    };
  }
  const o = clientCancellation(bookingMoney(b), ctx.now, policy);
  const { kept, refund } = refundAfterRetention(paid, o.retainedCents, policy);
  return {
    who: "client",
    policyVersion: policy.version,
    outcome: o,
    refund: {
      refundCents: partsTotal(refund),
      retainedCents: o.retainedCents,
      perTender: refund,
      kept,
    },
  };
}

export function cancel(ctx: Ctx) {
  return onBooking(ctx, async (b) => {
    const who = requireParty(ctx, b, "client", "tasker");
    const reason =
      optString(ctx.body, "reason")?.trim() ||
      (who === "client" ? "client canceled" : "tasker canceled");
    const policy = await loadPolicy(ctx.db, b.policy_version);
    if (who === "client") {
      transition(b, "canceled_client");
      const outcome = clientCancellation(bookingMoney(b), ctx.now, policy);
      return retainAndRefund(ctx, b, policy, outcome, "canceled_client", reason);
    }
    if (b.status === "requested") {
      throw new HttpError(409, "illegal_state", "use /decline for a booking you have not accepted");
    }
    transition(b, "canceled_tasker");
    return providerFault(ctx, b, policy, "canceled_tasker", reason);
  });
}

export function noShow(ctx: Ctx) {
  return onBooking(ctx, async (b) => {
    const who = reqString(ctx.body, "who");
    const actor = requireParty(ctx, b, "tasker", "admin");
    const policy = await loadPolicy(ctx.db, b.policy_version);
    if (ctx.now < new Date(b.start_at)) {
      throw new HttpError(409, "too_early", "a no-show can only be reported after the start time");
    }
    const reason = optString(ctx.body, "reason");
    if (who === "client") {
      transition(b, "no_show_client");
      return retainAndRefund(
        ctx,
        b,
        policy,
        clientNoShow(bookingMoney(b), policy),
        "no_show_client",
        reason ?? "client no-show",
      );
    }
    if (who === "tasker") {
      if (actor !== "admin")
        throw new HttpError(403, "forbidden", "only an admin can record a tasker no-show");
      transition(b, "no_show_tasker");
      return providerFault(ctx, b, policy, "no_show_tasker", reason ?? "tasker no-show");
    }
    throw new HttpError(400, "bad_request", "who must be 'client' or 'tasker'");
  });
}

export { bookingFigures };
