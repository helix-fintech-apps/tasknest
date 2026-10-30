// Quote, booking creation and the booking lifecycle (accept/decline/reschedule/start/complete/cancel/no-show),
// plus the server previews that show exactly what those actions will do.
//
// Pattern for every money operation: take the lease(s) -> load fresh state -> validate and plan with the
// shared domain code -> call the payment provider -> commit ALL rows + ledger txns in one tn_apply
// transaction. Nothing that can fail on business rules runs after a provider call.
//
// Card money (docs/contracts.md 4.2): a booking has a payment plan chosen by the server (planPayment). With a live
// hold, completion and fees CAPTURE it. With no live hold (card saved but not yet held, or the hold expired) the
// server charges the saved card off-session for exactly the amount, so the ledger postings are identical.

import {
  addDays,
  allocateTenders,
  applyBps,
  Allocation,
  BookingMoney,
  CancellationOutcome,
  CARD_CONSENT_TEXTS,
  clientCancellation,
  clientNoShow,
  consumeFifo,
  emptyParts,
  ExtrasFigures,
  extrasFigures,
  fitsSchedule,
  holdAtAfterReschedule,
  localToUtc,
  MoneyPolicy,
  needsReauth,
  partsTotal,
  PaymentPlan,
  planPayment,
  pointsEarned,
  promoDiscount,
  PromoCode,
  quote,
  refundAfterRetention,
  shouldSuspend,
  SLOT_HOLDING_STATUSES,
  taskerCancellation,
  TenderParts,
} from "../../_shared/domain/index.ts";
import {
  BookingRow,
  Db,
  loadBooking,
  loadLots,
  loadMovements,
  loadPolicy,
  loadTenders,
  lotsForDomain,
  must,
  PaymentState,
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
  sha256Hex,
  UUID_RE,
} from "../../_shared/http.ts";
import {
  captureTxn,
  extrasTxn,
  holdTxn,
  pointsIssueTxn,
  releaseHoldTxn,
  stripeFeeTxn,
  taskerPenaltyTxn,
} from "../../_shared/postings.ts";
import * as pts from "../../_shared/points-store.ts";
import { notify } from "../../_shared/notify.ts";
import { chargeSavedCard, hasLiveHold, Moved, placeHold, saveCard } from "../../_shared/holds.ts";
import { FAKE_DECLINE_PM, PaymentError, PaymentInput } from "../../_shared/provider/index.ts";
import { bookingFigures, Ctx, requireParty, requireRole, transition } from "../context.ts";

const ACTIVE: string[] = SLOT_HOLDING_STATUSES;
const LOCAL_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
/** How long a booking waits in pending_payment for the client to finish 3DS. */
const PENDING_PAYMENT_MINUTES = 30;

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
      .select("id, status, hourly_rate_cents, stripe_account_id, category")
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
    category: string;
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
    .not("status", "in", "(declined,canceled_client,canceled_tasker,payment_abandoned)");
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

// ---- Booking inputs ---------------------------------------------------------------------------------

/** `payment` in POST /bookings: confirmation_token | saved_method | simulated (docs/contracts.md 4.3). */
function parsePayment(raw: unknown): PaymentInput | null {
  if (raw === undefined || raw === null) return null;
  const bad = (m: string) => new HttpError(400, "bad_request", `payment: ${m}`);
  if (typeof raw !== "object" || Array.isArray(raw)) throw bad("must be an object");
  const p = raw as Record<string, unknown>;
  const str = (k: string) => {
    const v = p[k];
    if (typeof v !== "string" || !v.trim() || v.length > 200) throw bad(`${k} is required`);
    return v;
  };
  switch (p.kind) {
    case "confirmation_token":
      return { kind: "confirmation_token", id: str("id") };
    case "saved_method":
      return { kind: "saved_method", paymentMethodId: str("paymentMethodId") };
    case "simulated":
      return { kind: "simulated", token: str("token") };
    default:
      throw bad("kind must be confirmation_token, saved_method or simulated");
  }
}

function parseConsent(raw: unknown, policy: MoneyPolicy): string | null {
  if (raw === undefined || raw === null) return null;
  const v = (raw as { textVersion?: unknown }).textVersion;
  if (typeof v !== "string" || !Object.hasOwn(CARD_CONSENT_TEXTS, v))
    throw new HttpError(422, "rule_violation", "consent.textVersion is not a known consent text");
  if (policy.consent && policy.consent.textVersion !== v)
    throw new HttpError(
      422,
      "rule_violation",
      `consent text ${v} is not current; accept ${policy.consent.textVersion}`,
    );
  return v;
}

interface ClientCard {
  customerId: string | null;
  defaultMethodId: string | null;
}

export async function loadClientCard(db: Db, userId: string): Promise<ClientCard> {
  const { data } = await db
    .from("profiles")
    .select("stripe_customer_id, default_payment_method_id")
    .eq("id", userId)
    .maybeSingle();
  return {
    customerId: (data?.stripe_customer_id as string | null) ?? null,
    defaultMethodId: (data?.default_payment_method_id as string | null) ?? null,
  };
}

/** The tasker's schedule inputs: their time zone, weekly rules and per-date overrides. */
export async function loadSchedule(db: Db, taskerId: string, around?: { from: Date; to: Date }) {
  const { data: prof } = await db
    .from("profiles")
    .select("home_tz")
    .eq("id", taskerId)
    .maybeSingle();
  const { data: rules, error: e1 } = await db
    .from("tasker_availability")
    .select("weekday, start_minute, end_minute")
    .eq("tasker_id", taskerId);
  if (e1) throw pgToHttp(e1);
  let oq = db
    .from("tasker_availability_overrides")
    .select("date, kind, start_minute, end_minute")
    .eq("tasker_id", taskerId);
  if (around) {
    oq = oq
      .gte("date", new Date(around.from.getTime() - 2 * 86_400_000).toISOString().slice(0, 10))
      .lte("date", new Date(around.to.getTime() + 2 * 86_400_000).toISOString().slice(0, 10));
  }
  const { data: overrides, error: e2 } = await oq;
  if (e2) throw pgToHttp(e2);
  return {
    tz: (prof?.home_tz as string | undefined) ?? "America/Los_Angeles",
    rules: (rules ?? []).map((r) => ({
      weekday: r.weekday as number,
      startMinute: r.start_minute as number,
      endMinute: r.end_minute as number,
    })),
    overrides: (overrides ?? []).map((o) => ({
      date: o.date as string,
      kind: o.kind as "block" | "add",
      startMinute: o.start_minute as number,
      endMinute: o.end_minute as number,
    })),
  };
}

/** 409 `tasker_unavailable_at_time` unless the whole task lies inside the tasker's working hours. */
async function assertWithinSchedule(db: Db, taskerId: string, startAt: Date, minutes: number) {
  const sch = await loadSchedule(db, taskerId, {
    from: startAt,
    to: new Date(startAt.getTime() + minutes * 60_000),
  });
  if (!fitsSchedule(startAt, minutes, sch.tz, sch.rules, sch.overrides)) {
    throw new HttpError(
      409,
      "tasker_unavailable_at_time",
      "the tasker is not available at that time",
    );
  }
}

/** An active booking of the tasker that overlaps [startAt, startAt + minutes), other than `excludeId`. */
export async function findClash(
  db: Db,
  taskerId: string,
  startAt: Date,
  minutes: number,
  excludeId?: string,
): Promise<boolean> {
  const { data: clash } = await db
    .from("bookings")
    .select("id, start_at, est_minutes")
    .eq("tasker_id", taskerId)
    .in("status", ACTIVE)
    .lt("start_at", new Date(startAt.getTime() + minutes * 60_000).toISOString())
    .gte("start_at", new Date(startAt.getTime() - 24 * 3_600_000).toISOString());
  for (const c of clash ?? []) {
    if (c.id === excludeId) continue;
    const s = new Date(c.start_at).getTime();
    if (s + c.est_minutes * 60_000 > startAt.getTime()) return true;
  }
  return false;
}

async function checkCategory(db: Db, slug: string, taskerCategory: string) {
  const { data: cat } = await db
    .from("categories")
    .select("slug, name, active")
    .eq("slug", slug)
    .maybeSingle();
  if (!cat || !cat.active) throw new HttpError(422, "rule_violation", `unknown category ${slug}`);
  const t = taskerCategory.toLowerCase();
  if (t !== cat.slug && t !== String(cat.name).toLowerCase())
    throw new HttpError(422, "rule_violation", `this tasker does not offer ${cat.name}`);
}

const planView = (plan: PaymentPlan) => ({
  mode: plan.mode,
  cardCents: plan.cardCents,
  holdAt: plan.holdAt ? plan.holdAt.toISOString() : null,
  reason: plan.reason,
});

// ---- POST /quote --------------------------------------------------------------------------------------

export async function quoteHandler(ctx: Ctx) {
  const b = ctx.body;
  const taskerId = reqUuid(b, "taskerId");
  const minutes = reqInt(b, "minutes", 1);
  if (minutes > 24 * 60) throw new HttpError(400, "bad_request", "minutes must be <= 1440");
  const anon = ctx.user.role === "anon";
  const promoCode = optString(b, "promoCode");
  const pointsRequested = optInt(b, "pointsRequested") ?? 0;
  if (anon && (promoCode || pointsRequested > 0))
    throw new HttpError(401, "unauthorized", "sign in to use a promo code or points");
  const categorySlug = optString(b, "categorySlug");
  const localStart = optString(b, "localStart");
  const tz = optString(b, "tz");
  if ((localStart === undefined) !== (tz === undefined))
    throw new HttpError(400, "bad_request", "send localStart and tz together");
  let startAt: Date | null = null;
  if (localStart && tz) {
    checkLocalStart(localStart);
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: tz });
    } catch {
      throw new HttpError(400, "bad_request", `unknown time zone ${tz}`);
    }
    startAt = localToUtc(localStart, tz);
  }
  const tasker = await loadActiveTasker(ctx, taskerId);
  if (categorySlug) await checkCategory(ctx.db, categorySlug, tasker.category);
  const policy = await loadPolicy(ctx.db, undefined, ctx.now);
  const q = quote(Number(tasker.hourly_rate_cents), minutes, policy);
  const discountCents = await promoFor(ctx, promoCode, q.subtotal);
  const lots = anon
    ? { availableNet: 0, pending: 0 }
    : lotsForDomain(await loadLots(ctx.db, ctx.user.id), ctx.now);
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
  const plan = startAt
    ? planPayment({ startAt, now: ctx.now, cardCents: allocation.parts.card }, policy)
    : null;
  return {
    quote: q,
    allocation,
    discountCents,
    promoCode: promoCode?.toUpperCase() ?? null,
    policyVersion: policy.version,
    points: { available: lots.availableNet, pending: lots.pending },
    paymentPlan: plan ? planView(plan) : null,
    cardMinimumApplied: allocation.cardMinimumApplied === true,
    responseDeadline: new Date(
      ctx.now.getTime() + policy.booking.taskerResponseHours * 3_600_000,
    ).toISOString(),
  };
}

// ---- POST /bookings ----------------------------------------------------------------------------------

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
  const legacyMethod = optString(b, "paymentMethod");
  const payment = parsePayment(b.payment);
  const categorySlug = optString(b, "categorySlug");
  const addressId = optString(b, "addressId");
  if (addressId && !UUID_RE.test(addressId))
    throw new HttpError(400, "bad_request", "addressId must be a uuid");
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
    const consentVersion = parseConsent(b.consent, policy);
    if (categorySlug) await checkCategory(ctx.db, categorySlug, tasker.category);
    if (addressId) {
      const { data: addr } = await ctx.db
        .from("addresses")
        .select("id")
        .eq("id", addressId.toLowerCase())
        .eq("user_id", ctx.user.id)
        .maybeSingle();
      if (!addr) throw new HttpError(422, "rule_violation", "that address is not yours");
    }
    await assertWithinSchedule(ctx.db, taskerId, startAt, minutes);
    const q = quote(Number(tasker.hourly_rate_cents), minutes, policy);
    const discountCents = await promoFor(ctx, promoCode, q.subtotal);
    const lots = lotsForDomain(await loadLots(ctx.db, ctx.user.id), ctx.now);
    const alloc: Allocation = allocateTenders(
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
    const plan = planPayment({ startAt, now: ctx.now, cardCents: alloc.parts.card }, policy);

    // Quick pre-check (the unit of work re-checks under a per-tasker lock inside the transaction).
    if (await findClash(ctx.db, taskerId, startAt, minutes)) {
      throw new HttpError(409, "slot_taken", "tasker already has a booking in that time slot");
    }

    // The card to use: the one in the request, else the client's default. No silent fallback to a test card.
    const card = await loadClientCard(ctx.db, ctx.user.id);
    const savedMethodId =
      payment?.kind === "saved_method"
        ? payment.paymentMethodId
        : (legacyMethod ?? card.defaultMethodId);
    if (plan.mode !== "card_not_needed" && !payment && !savedMethodId) {
      throw new HttpError(
        422,
        "payment_method_required",
        "add a card to book this task; none is saved on your account",
      );
    }
    let customerId = card.customerId;
    if (plan.mode !== "card_not_needed" && !customerId) {
      try {
        customerId = (await ctx.provider.ensureCustomer(ctx.user.id, ctx.user.email)).customerId;
        const { error } = await ctx.db
          .from("profiles")
          .update({ stripe_customer_id: customerId })
          .eq("id", ctx.user.id)
          .is("stripe_customer_id", null);
        if (error) throw pgToHttp(error);
      } catch (e) {
        if (!(e instanceof PaymentError && e.code === "not_implemented")) throw e;
      }
    }

    const bookingId = crypto.randomUUID();
    let hold: Moved | null = null;
    let status: "requested" | "pending_payment" = "requested";
    let paymentState: PaymentState = "none";
    let methodId: string | null = savedMethodId;
    let setupIntentId: string | null = null;
    let clientSecret: string | undefined;
    if (plan.mode === "hold_now") {
      hold = await placeHold(ctx.provider, {
        amountCents: plan.cardCents,
        bookingId,
        customerId,
        payment,
        savedMethodId,
        idempotencyKey: `${ctx.opKey}:auth`,
      });
      methodId = hold.paymentMethodId ?? methodId;
      clientSecret = hold.clientSecret;
      if (hold.status === "requires_action") {
        status = "pending_payment";
        paymentState = "requires_action";
      } else {
        paymentState = plan.legacy ? "none" : "hold_active";
      }
    } else if (plan.mode === "save_card_hold_later") {
      if (
        ctx.provider.name === "fake" &&
        (legacyMethod === FAKE_DECLINE_PM || savedMethodId === FAKE_DECLINE_PM)
      ) {
        throw new PaymentError("card_declined", "Your card was declined.");
      }
      const saved = await saveCard(ctx.provider, {
        customerId,
        payment,
        savedMethodId,
        idempotencyKey: `${ctx.opKey}:setup`,
      });
      methodId = saved.paymentMethodId ?? methodId;
      setupIntentId = saved.setupIntentId ?? null;
      clientSecret = saved.clientSecret;
      if (saved.requiresAction) {
        status = "pending_payment";
        paymentState = "requires_action";
      } else {
        paymentState = "card_saved";
      }
    }
    const authExpires =
      hold && plan.legacy && status === "requested"
        ? addDays(ctx.now, policy.auth.validityDays)
        : null;

    const uow = new UnitOfWork(ctx.idemKey ? ctx.opKey : undefined);
    uow.assertSlotFree(taskerId, startAt, minutes);
    uow.insert("bookings", {
      id: bookingId,
      client_id: ctx.user.id,
      tasker_id: taskerId,
      policy_version: policy.version,
      status,
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
      stripe_payment_intent_id: hold?.intentId ?? null,
      auth_expires_at: authExpires?.toISOString() ?? null,
      created_at: ctx.now.toISOString(),
      category_slug: categorySlug ?? null,
      address_id: addressId?.toLowerCase() ?? null,
      payment_plan: plan.mode,
      payment_state: paymentState,
      hold_at: plan.holdAt?.toISOString() ?? null,
      capture_before: hold?.captureBefore ?? null,
      stripe_charge_id: hold?.chargeId ?? null,
      stripe_customer_id: customerId,
      payment_method_id: methodId,
      setup_intent_id: setupIntentId,
      payment_expires_at:
        status === "pending_payment"
          ? new Date(ctx.now.getTime() + PENDING_PAYMENT_MINUTES * 60_000).toISOString()
          : null,
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
    if (hold) {
      uow.insert("payment_intents", {
        id: hold.intentId,
        booking_id: bookingId,
        kind: "hold",
        amount_cents: plan.cardCents,
        status: hold.status,
        charge_id: hold.chargeId ?? null,
        capture_before: hold.captureBefore ?? null,
        created_at: ctx.now.toISOString(),
      });
      recordBalanceTxn(uow, bookingId, hold);
    }
    if (consentVersion && methodId) {
      uow.insert("card_consents", {
        user_id: ctx.user.id,
        payment_method_id: methodId,
        booking_id: bookingId,
        text_version: consentVersion,
        text_sha256: await sha256Hex(CARD_CONSENT_TEXTS[consentVersion]),
        created_at: ctx.now.toISOString(),
      });
    }
    if (status === "requested") {
      notify(uow, {
        userId: taskerId,
        kind: "booking_requested",
        bookingId,
        title: "New booking request",
        body: `Respond within ${policy.booking.taskerResponseHours} hours.`,
      });
    }
    try {
      await uow.commit(ctx.db);
    } catch (e) {
      if (hold) await ctx.provider.cancel(hold.intentId, `${ctx.opKey}:auth:void`).catch(() => {});
      throw e;
    }
    return bookingResponse(ctx, bookingId, {
      quote: q,
      allocation: alloc,
      discountCents,
      policyVersion: policy.version,
      needsReauth: plan.legacy
        ? needsReauth(ctx.now, startAt, policy.auth.validityDays, policy.auth.reauthBufferDays)
        : false,
      cardMinimumApplied: alloc.cardMinimumApplied === true,
      paymentPlan: planView(plan),
      payment: {
        state: paymentState,
        ...(clientSecret ? { clientSecret } : {}),
        ...(hold?.captureBefore ? { captureBefore: hold.captureBefore } : {}),
        ...(plan.holdAt ? { holdAt: plan.holdAt.toISOString() } : {}),
        ...(status === "pending_payment"
          ? {
              expiresAt: new Date(
                ctx.now.getTime() + PENDING_PAYMENT_MINUTES * 60_000,
              ).toISOString(),
            }
          : {}),
      },
    });
  });
}

/** Store a Stripe balance transaction and book its processing fee (Stripe mode; the fake fee is 0). */
export function recordBalanceTxn(uow: UnitOfWork, bookingId: string, m: Moved): void {
  const bt = m.balanceTxn;
  if (!bt) return;
  uow.insert("stripe_balance_transactions", {
    id: bt.id,
    source_id: m.chargeId ?? m.intentId,
    booking_id: bookingId,
    type: bt.type,
    amount_cents: bt.amountCents,
    fee_cents: bt.feeCents,
    net_cents: bt.netCents,
    available_on: bt.availableOn ?? null,
  });
  uow.ledger(stripeFeeTxn(bookingId, bt.feeCents), undefined, `bt:${bt.id}:fee`);
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

/** Where the booking's payment_state goes when its hold is released without a capture. */
function releasedState(b: BookingRow): PaymentState {
  return [
    "hold_active",
    "card_saved",
    "requires_action",
    "hold_expired",
    "action_required",
  ].includes(b.payment_state)
    ? "released"
    : b.payment_state;
}

/** What the card is charged for `amount`: capture the live hold, or charge the saved card off-session. */
export type CardTake = { mode: "capture" | "charge" };
export function cardTake(b: BookingRow, now: Date): CardTake {
  return { mode: hasLiveHold(b, now) ? "capture" : "charge" };
}

/**
 * Take `amountCents` from the client's card (capture the live hold, or charge the saved card), once.
 * `authentication_required` is recorded on the booking (`action_required`, plus a notification) only when no
 * card money has moved yet in this request, so a retry can never charge twice; the caller then gets a 402.
 */
async function takeCardMoney(
  ctx: Ctx,
  b: BookingRow,
  amountCents: number,
  how: {
    kind: "capture_fallback" | "fee" | "extras";
    legacyKind: "reauth" | "extras";
    key: string;
    description: string;
    /** Capture the live hold with this key; absent for charges that are never held (extras). */
    captureKey?: string;
    firstMove: boolean;
  },
): Promise<{ intentId: string; captured: boolean; moved: Moved | null }> {
  if (how.captureKey && hasLiveHold(b, ctx.now)) {
    await ctx.provider.capture(b.stripe_payment_intent_id!, amountCents, how.captureKey);
    return { intentId: b.stripe_payment_intent_id!, captured: true, moved: null };
  }
  const client = await loadClientCard(ctx.db, b.client_id);
  const m = await chargeSavedCard(ctx.provider, {
    amountCents,
    bookingId: b.id,
    customerId: b.stripe_customer_id ?? client.customerId,
    paymentMethodId: b.payment_method_id ?? client.defaultMethodId,
    kind: how.kind,
    legacyKind: how.legacyKind,
    idempotencyKey: how.key,
    description: how.description,
  });
  if (m.status === "requires_action") {
    if (how.firstMove) {
      const uow = new UnitOfWork();
      uow.update("bookings", { id: b.id }, { payment_state: "action_required" });
      notify(uow, {
        userId: b.client_id,
        kind: "payment_action_required",
        bookingId: b.id,
        title: "Your bank needs you to approve a charge",
        body: "Open the booking to approve the payment.",
      });
      await uow.commit(ctx.db);
    }
    throw new PaymentError(
      "authentication_required",
      "The client's bank needs them to approve this charge before it can be completed.",
      402,
    );
  }
  return { intentId: m.intentId, captured: false, moved: m };
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
    {
      status: toStatus,
      canceled_at: ctx.now.toISOString(),
      captured_cents: kept.card,
      ...(kept.card === 0 && b.payment_state !== "none" ? { payment_state: releasedState(b) } : {}),
    },
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
  if (toStatus === "canceled_client") {
    notify(uow, {
      userId: b.tasker_id,
      kind: "booking_canceled",
      bookingId: b.id,
      title: "A booking was canceled",
      body: reason,
    });
  }

  // Money: take what we keep (the rest of a live hold is released by the provider).
  if (kept.card > 0) {
    if (!hasLiveHold(b, ctx.now) && !b.payment_method_id) {
      const c = await loadClientCard(ctx.db, b.client_id);
      if (!c.defaultMethodId)
        throw new HttpError(409, "provider_mismatch", "booking has no card on file to charge");
    }
    const t = await takeCardMoney(ctx, b, kept.card, {
      kind: "fee",
      legacyKind: "reauth",
      key: `${b.id}:fee`,
      description: `TaskNest ${kind} ${b.id}`,
      captureKey: `${b.id}:capture`,
      firstMove: true,
    });
    const set: Record<string, unknown> = {};
    if (b.payment_state !== "none") set.payment_state = "captured";
    if (!t.captured) set.stripe_payment_intent_id = t.intentId;
    if (Object.keys(set).length) uow.update("bookings", { id: b.id }, set);
    if (!t.captured && t.moved) {
      uow.insert("payment_intents", {
        id: t.intentId,
        booking_id: b.id,
        kind: "fee",
        amount_cents: kept.card,
        status: "succeeded",
        charge_id: t.moved.chargeId ?? null,
        created_at: ctx.now.toISOString(),
      });
      recordBalanceTxn(uow, b.id, t.moved);
    } else if (t.captured) {
      uow.update("payment_intents", { id: t.intentId }, { status: "succeeded" }, -1);
    }
  }
  await uow.commit(ctx.db);
  if (kept.card === 0 && b.stripe_payment_intent_id) {
    await ctx.provider.cancel(b.stripe_payment_intent_id, `${b.id}:cancel`).catch(() => {});
    await ctx.db
      .from("payment_intents")
      .update({ status: "canceled" })
      .eq("id", b.stripe_payment_intent_id);
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
export async function providerFault(
  ctx: Ctx,
  b: BookingRow,
  policy: MoneyPolicy,
  toStatus: "declined" | "canceled_tasker" | "no_show_tasker" | "payment_abandoned",
  reason: string,
) {
  // declined and payment_abandoned are nobody's fault: full release, no refund row, no strike.
  const faultless = toStatus === "declined" || toStatus === "payment_abandoned";
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
      {
        status: toStatus,
        canceled_at: ctx.now.toISOString(),
        ...(b.payment_state !== "none" ? { payment_state: releasedState(b) } : {}),
      },
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
    if (!faultless) {
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
    notify(uow, {
      userId: b.client_id,
      kind:
        toStatus === "declined"
          ? "booking_declined"
          : toStatus === "payment_abandoned"
            ? "payment_abandoned"
            : "booking_canceled",
      bookingId: b.id,
      title:
        toStatus === "declined"
          ? "Your booking request was declined"
          : toStatus === "payment_abandoned"
            ? "Your booking was not completed"
            : "Your tasker canceled this booking",
      body: "Your hold was released and any points or credit returned.",
    });
    await uow.commit(ctx.db);
    return { suspended, strikeCount };
  };
  // Strikes are counted per tasker: serialize strike-bearing operations for the same tasker.
  const { suspended, strikeCount } = faultless
    ? await run()
    : await withLocks(ctx.db, [`tasker:${b.tasker_id}`], run);
  if (b.stripe_payment_intent_id) {
    await ctx.provider.cancel(b.stripe_payment_intent_id, `${b.id}:cancel`).catch(() => {});
    await ctx.db
      .from("payment_intents")
      .update({ status: "canceled" })
      .eq("id", b.stripe_payment_intent_id);
  }
  return bookingResponse(ctx, b.id, {
    outcome,
    refund: { refundCents: partsTotal(paid), retainedCents: 0, perTender: paid },
    strike: faultless
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
    notify(uow, {
      userId: b.client_id,
      kind: "booking_accepted",
      bookingId: b.id,
      title: "Your tasker accepted",
      body: "Your task is scheduled.",
    });
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

/** The new start for a reschedule, validated the same way for the action and its preview. */
function rescheduleTarget(ctx: Ctx, b: BookingRow): Date {
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
  return startAt;
}

export function reschedule(ctx: Ctx) {
  return onBooking(ctx, async (b) => {
    const who = requireParty(ctx, b, "client", "tasker");
    const startAt = rescheduleTarget(ctx, b);
    await assertWithinSchedule(ctx.db, b.tasker_id, startAt, b.est_minutes);
    const policy = await loadPolicy(ctx.db, b.policy_version);
    const uow = new UnitOfWork();
    uow.assertSlotFree(b.tasker_id, startAt, b.est_minutes, b.id);
    // original_start_at is deliberately NOT changed: the cancellation cutoff stays anchored to it.
    // A scheduled hold moves with the booking (never into the past; the hold job places it when due).
    uow.update(
      "bookings",
      { id: b.id, status: b.status },
      {
        start_at: startAt.toISOString(),
        ...(b.payment_state === "card_saved"
          ? { hold_at: holdAtAfterReschedule(startAt, ctx.now, policy).toISOString() }
          : {}),
      },
    );
    uow.audit(ctx.user.id, "rescheduled", "booking", b.id, undefined, {
      from: b.start_at,
      to: startAt.toISOString(),
    });
    notify(uow, {
      userId: who === "client" ? b.tasker_id : b.client_id,
      kind: "booking_rescheduled",
      bookingId: b.id,
      title: "A booking was rescheduled",
      body: `New start: ${startAt.toISOString()}`,
    });
    await uow.commit(ctx.db);
    return bookingResponse(ctx, b.id);
  });
}

// POST /bookings/:id/reschedule-preview: side-effect free.
export async function reschedulePreview(ctx: Ctx) {
  const b = await loadBooking(ctx.db, ctx.params.id);
  requireParty(ctx, b, "client", "tasker");
  const startAt = rescheduleTarget(ctx, b);
  const policy = await loadPolicy(ctx.db, b.policy_version);
  const sch = await loadSchedule(ctx.db, b.tasker_id, {
    from: startAt,
    to: new Date(startAt.getTime() + b.est_minutes * 60_000),
  });
  let problem: string | undefined;
  if (!fitsSchedule(startAt, b.est_minutes, sch.tz, sch.rules, sch.overrides))
    problem = "tasker_unavailable_at_time";
  else if (await findClash(ctx.db, b.tasker_id, startAt, b.est_minutes, b.id))
    problem = "slot_taken";
  const newHoldAt =
    b.payment_state === "card_saved" ? holdAtAfterReschedule(startAt, ctx.now, policy) : null;
  return {
    startAt: startAt.toISOString(),
    slotFree: problem === undefined,
    ...(problem ? { problem } : {}),
    cancellationAnchor: new Date(b.original_start_at).toISOString(),
    holdPlanChange: newHoldAt ? { from: b.hold_at, to: newHoldAt.toISOString() } : null,
    policyVersion: policy.version,
  };
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

// ---- Completion --------------------------------------------------------------------------------------

interface CompletionInput {
  extraMinutes: number;
  expensesCents: number;
}

function readCompletionInput(ctx: Ctx): CompletionInput {
  const extraMinutes = optInt(ctx.body, "extraMinutes") ?? 0;
  const expensesCents = optInt(ctx.body, "expensesCents") ?? 0;
  if (extraMinutes > 24 * 60)
    throw new HttpError(400, "bad_request", "extraMinutes must be <= 1440");
  if (expensesCents > 1_000_000)
    throw new HttpError(400, "bad_request", "expensesCents must be <= 1000000");
  return { extraMinutes, expensesCents };
}

/** Everything completing a booking will do with money; shared by the action and its preview. */
function completionPlan(
  b: BookingRow,
  policy: MoneyPolicy,
  paid: TenderParts,
  input: CompletionInput,
  now: Date,
) {
  const x: ExtrasFigures = extrasFigures(
    Number(b.rate_cents),
    input.extraMinutes,
    input.expensesCents,
    policy,
  );
  const take = paid.card > 0 ? cardTake(b, now) : null;
  return { x, take };
}

// POST /bookings/:id/complete-preview: side-effect free.
export async function completePreview(ctx: Ctx) {
  const b = await loadBooking(ctx.db, ctx.params.id);
  requireParty(ctx, b, "tasker");
  const input = readCompletionInput(ctx);
  const policy = await loadPolicy(ctx.db, b.policy_version);
  const { paid } = await loadTenders(ctx.db, b.id);
  const { x, take } = completionPlan(b, policy, paid, input, ctx.now);
  const problem =
    b.status !== "in_progress"
      ? `cannot complete a ${b.status} booking; start it first`
      : x.problem;
  const mainNow = take && take.mode === "charge" ? paid.card : 0;
  return {
    extraLaborCents: x.extraLaborCents,
    extraFeeCents: x.extraFeeCents,
    extraTaxCents: x.extraTaxCents,
    expensesCents: x.expensesCents,
    extrasCardCents: x.totalCents,
    captureCardCents: paid.card,
    releaseCents: 0,
    taskerNetDeltaCents: x.taskerPayCents,
    // What the client's card is charged by this action: the extras, plus the main amount when there is no live
    // hold to capture (the hold is not a charge until captured, so the button names the real amount).
    cardChargedNowCents: x.totalCents + mainNow,
    mainCardMode: take ? take.mode : "none",
    policyVersion: policy.version,
    ...(problem ? { problem } : {}),
  };
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
    const input = readCompletionInput(ctx);
    const policy = await loadPolicy(ctx.db, b.policy_version);
    const { paid } = await loadTenders(ctx.db, b.id);
    const movs = await loadMovements(ctx.db, b.id);
    const held = pts.reservedByLot(movs);

    const { x } = completionPlan(b, policy, paid, input, ctx.now);
    if (x.problem) throw new HttpError(422, "rule_violation", x.problem);
    const extraTotal = x.totalCents;
    const cardPaid = paid.card + extraTotal;
    const earned = pointsEarned(
      cardPaid,
      Number(b.tax_cents) + x.extraTaxCents,
      Number(b.total_cents) + extraTotal,
      policy,
    );
    const commission = applyBps(Number(b.subtotal_cents), policy.taskerCommissionBps);

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
            taskerPay: x.taskerPayCents,
            platform: x.platformCents,
            tax: x.extraTaxCents,
          })
        : null;

    // Money. The main amount: capture the live hold, else charge the saved card for exactly that amount
    // (an expired v1 authorization is charged again, as before). Extras are always a separate charge.
    let piId = b.stripe_payment_intent_id;
    let mainCharge: Moved | null = null;
    let moved = false;
    if (paid.card > 0) {
      const t = await takeCardMoney(ctx, b, paid.card, {
        kind: "capture_fallback",
        legacyKind: "reauth",
        key: `${b.id}:reauth`,
        description: `TaskNest booking ${b.id} (charged at completion)`,
        captureKey: `${b.id}:capture`,
        firstMove: true,
      });
      piId = t.intentId;
      mainCharge = t.captured ? null : t.moved;
      moved = true;
    }
    let extraPi: string | null = null;
    let extraCharge: Moved | null = null;
    if (extraTotal > 0) {
      const t = await takeCardMoney(ctx, b, extraTotal, {
        kind: "extras",
        legacyKind: "extras",
        key: `${b.id}:extras`,
        description: `TaskNest extras ${b.id}`,
        firstMove: !moved,
      });
      extraPi = t.intentId;
      extraCharge = t.moved;
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
        extra_labor_cents: x.extraLaborCents,
        extra_service_fee_cents: x.extraFeeCents,
        extra_tax_cents: x.extraTaxCents,
        expenses_cents: x.expensesCents,
        extra_payment_intent_id: extraPi,
        points_earned: earned,
        ...(b.payment_state !== "none" && paid.card > 0 ? { payment_state: "captured" } : {}),
      },
    );
    if (paid.card > 0) {
      if (mainCharge) {
        uow.insert("payment_intents", {
          id: mainCharge.intentId,
          booking_id: b.id,
          kind: "hold",
          amount_cents: paid.card,
          status: "succeeded",
          charge_id: mainCharge.chargeId ?? null,
          created_at: ctx.now.toISOString(),
        });
        recordBalanceTxn(uow, b.id, mainCharge);
      } else if (piId) {
        uow.update("payment_intents", { id: piId }, { status: "succeeded" }, -1);
      }
    }
    if (extraPi && extraTotal > 0) {
      uow.insert("payment_intents", {
        id: extraPi,
        booking_id: b.id,
        kind: "extras",
        amount_cents: extraTotal,
        status: "succeeded",
        charge_id: extraCharge?.chargeId ?? null,
        created_at: ctx.now.toISOString(),
      });
      if (extraCharge) recordBalanceTxn(uow, b.id, extraCharge);
    }
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
    notify(uow, {
      userId: b.client_id,
      kind: "booking_completed",
      bookingId: b.id,
      title: "Your task is done",
      body: "Rate your tasker and leave a tip if you like.",
    });
    await uow.commit(ctx.db);
    return bookingResponse(ctx, b.id, {
      captured: { cardCents: paid.card, extrasCents: extraTotal, pointsRedeemed: redeemed },
      pointsEarned: earned,
      payment: { extras: { state: extraTotal > 0 ? "succeeded" : "none" } },
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
    cardChargeCents: kept.card,
    cardMode: kept.card > 0 ? cardTake(b, ctx.now).mode : "none",
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

// GET /bookings/:id/no-show-preview?who=client|tasker: what recording that no-show would do. No side effects.
export async function noShowPreview(ctx: Ctx) {
  const b = await loadBooking(ctx.db, ctx.params.id);
  requireParty(ctx, b, "tasker", "admin");
  const who = ctx.query.who;
  if (who !== "client" && who !== "tasker")
    throw new HttpError(400, "bad_request", "who must be 'client' or 'tasker'");
  const policy = await loadPolicy(ctx.db, b.policy_version);
  const { paid } = await loadTenders(ctx.db, b.id);
  const base = {
    who,
    policyVersion: policy.version,
    allowedNow: ctx.now >= new Date(b.start_at),
    startAt: b.start_at,
  };
  if (who === "tasker") {
    const o = taskerCancellation(bookingMoney(b), policy);
    return {
      ...base,
      outcome: o,
      refund: {
        refundCents: partsTotal(paid),
        retainedCents: 0,
        perTender: paid,
        kept: emptyParts(),
      },
      cardChargeCents: 0,
      cardMode: "none",
      taskerFeeCents: o.taskerFeeCents,
    };
  }
  const o = clientNoShow(bookingMoney(b), policy);
  const { kept, refund } = refundAfterRetention(paid, o.retainedCents, policy);
  return {
    ...base,
    outcome: o,
    refund: {
      refundCents: partsTotal(refund),
      retainedCents: o.retainedCents,
      perTender: refund,
      kept,
    },
    cardChargeCents: kept.card,
    cardMode: kept.card > 0 ? cardTake(b, ctx.now).mode : "none",
    taskerFeeCents: 0,
  };
}

// POST /bookings/:id/report-no-show: the client says the tasker did not come. A support request, not a refund
// (plan decision D7): staff review it and, if it is true, record the tasker no-show.
export function reportNoShow(ctx: Ctx) {
  return onBooking(ctx, async (b) => {
    requireParty(ctx, b, "client");
    if (!["accepted", "in_progress"].includes(b.status))
      throw new HttpError(409, "illegal_state", `cannot report a no-show on a ${b.status} booking`);
    if (ctx.now < new Date(b.start_at))
      throw new HttpError(409, "too_early", "a no-show can only be reported after the start time");
    const { data: open } = await ctx.db
      .from("support_requests")
      .select("id")
      .eq("booking_id", b.id)
      .eq("kind", "no_show")
      .neq("status", "resolved")
      .limit(1);
    if ((open ?? []).length > 0)
      throw new HttpError(409, "already_reported", "a no-show report is already open");
    const note = optString(ctx.body, "note")?.trim() ?? "";
    if (note.length > 2000) throw new HttpError(400, "bad_request", "note is too long (max 2000)");
    const id = crypto.randomUUID();
    const uow = new UnitOfWork(ctx.idemKey ? ctx.opKey : undefined);
    uow.insert("support_requests", {
      id,
      booking_id: b.id,
      requester_id: ctx.user.id,
      kind: "no_show",
      status: "open",
      amount_at_stake_cents: Number(b.total_cents),
      due_at: new Date(ctx.now.getTime() + 24 * 3_600_000).toISOString(),
      created_at: ctx.now.toISOString(),
    });
    if (note) {
      uow.insert("support_replies", {
        request_id: id,
        author_id: ctx.user.id,
        body: note,
        internal: false,
        created_at: ctx.now.toISOString(),
      });
    }
    notify(uow, {
      userId: b.tasker_id,
      kind: "no_show_reported",
      bookingId: b.id,
      title: "A client says you did not arrive",
      body: "Support will review this. Reply if it is a mistake.",
    });
    uow.audit(ctx.user.id, "no_show_reported", "booking", b.id, note || undefined);
    await uow.commit(ctx.db);
    return { request: { id, bookingId: b.id, kind: "no_show", status: "open" } };
  });
}

export { bookingFigures };
