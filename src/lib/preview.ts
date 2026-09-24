// Client-side previews built ONLY from the shared domain functions. The API is the source of truth;
// these exist so users see exact numbers before they confirm.

import {
  allocateTenders,
  applyBps,
  clientCancellation,
  emptyParts,
  promoDiscount,
  quote,
  refundAfterRetention,
  taskerCancellation,
  validateTip,
  planRefund,
  partsTotal,
  availablePoints,
  pendingPoints,
  type Allocation,
  type CancellationOutcome,
  type MoneyPolicy,
  type PromoCode,
  type Quote,
  type TenderParts,
  type RefundKind,
  type Actor,
  type RefundPlan,
  type PointsLot,
} from "@domain";
import type { BookingRow, PointsLotRow, PromoCodeRow, TenderRow } from "./supabase";
import { formatCents } from "@domain";

export function toPromo(row: PromoCodeRow): PromoCode {
  return {
    code: row.code,
    kind: row.kind,
    value: row.value,
    firstTaskOnly: row.first_task_only,
    maxDiscountCents: row.max_discount_cents ?? undefined,
    expiresAt: row.expires_at ? new Date(row.expires_at) : undefined,
  };
}

export interface QuotePreviewInput {
  rateCents: number;
  minutes: number;
  policy: MoneyPolicy;
  promo: PromoCodeRow | null;
  promoCodeEntered: string;
  isFirstTask: boolean;
  promoAlreadyUsed: boolean;
  pointsRequested: number;
  pointsBalance: number;
  walletCents: number;
  now: Date;
}

export interface QuotePreview {
  quote: Quote | null;
  discountCents: number;
  promoError: string | null;
  allocation: Allocation | null;
  allocationError: string | null;
  error: string | null;
}

export function previewQuote(i: QuotePreviewInput): QuotePreview {
  const out: QuotePreview = {
    quote: null,
    discountCents: 0,
    promoError: null,
    allocation: null,
    allocationError: null,
    error: null,
  };
  try {
    out.quote = quote(i.rateCents, i.minutes, i.policy);
  } catch (e) {
    out.error = (e as Error).message;
    return out;
  }
  const code = i.promoCodeEntered.trim().toUpperCase();
  if (code) {
    if (!i.promo) out.promoError = "Unknown promo code";
    else {
      try {
        out.discountCents = promoDiscount(
          toPromo(i.promo),
          out.quote.subtotal,
          i.isFirstTask,
          i.promoAlreadyUsed,
          i.now,
        );
      } catch (e) {
        out.promoError = (e as Error).message;
      }
    }
  }
  try {
    out.allocation = allocateTenders(
      out.quote.total,
      {
        promoCents: out.discountCents,
        walletCents: i.walletCents,
        pointsBalance: i.pointsBalance,
        pointsRequested: i.pointsRequested,
      },
      i.policy,
    );
  } catch (e) {
    out.allocationError = (e as Error).message;
  }
  return out;
}

/** What each tender actually paid (net of earlier refunds). */
export function paidParts(tenders: TenderRow[], netOfRefunds = true): TenderParts {
  const p = emptyParts();
  for (const t of tenders)
    p[t.tender] += Number(t.amount_cents) - (netOfRefunds ? Number(t.refunded_cents) : 0);
  return p;
}

export function refundedParts(tenders: TenderRow[]): TenderParts {
  const p = emptyParts();
  for (const t of tenders) p[t.tender] += Number(t.refunded_cents);
  return p;
}

export interface CancelPreview {
  outcome: CancellationOutcome;
  kept: TenderParts;
  refund: TenderParts;
  tierText: string;
  taskerFeeCents?: number;
}

export function bookingMoney(b: BookingRow) {
  return {
    rateCents: Number(b.rate_cents),
    subtotal: Number(b.subtotal_cents),
    serviceFee: Number(b.service_fee_cents),
    tax: Number(b.tax_cents),
    total: Number(b.total_cents),
    cutoffAnchorAt: new Date(b.original_start_at), // reschedules never move the cutoff
  };
}

export function tierDescription(policy: MoneyPolicy, tierIndex: number): string {
  const tiers = [...policy.cancellation.tiers].sort((a, z) => z.minHoursBefore - a.minHoursBefore);
  const t = tiers[tierIndex];
  if (!t) return "";
  const upper = tierIndex > 0 ? tiers[tierIndex - 1].minHoursBefore : null;
  const window =
    upper === null
      ? `${t.minHoursBefore}h or more before start`
      : t.minHoursBefore === 0
        ? `Less than ${upper}h before start (or after)`
        : `${t.minHoursBefore}–${upper}h before start`;
  const what = t.chargeMinutesOfRate
    ? `charged ${t.chargeMinutesOfRate} min of the tasker's rate`
    : `${t.refundBps / 100}% refunded`;
  return `${window}: ${what}`;
}

export function previewClientCancel(
  b: BookingRow,
  tenders: TenderRow[],
  policy: MoneyPolicy,
  now: Date,
): CancelPreview {
  const outcome = clientCancellation(bookingMoney(b), now, policy);
  const { kept, refund } = refundAfterRetention(paidParts(tenders), outcome.retainedCents, policy);
  return { outcome, kept, refund, tierText: tierDescription(policy, outcome.tierIndex) };
}

export function previewTaskerCancel(
  b: BookingRow,
  tenders: TenderRow[],
  policy: MoneyPolicy,
): CancelPreview {
  const outcome = taskerCancellation(bookingMoney(b), policy);
  const { kept, refund } = refundAfterRetention(paidParts(tenders), 0, policy);
  return {
    outcome,
    kept,
    refund,
    tierText: "Tasker cancellation: client refunded in full",
    taskerFeeCents: outcome.taskerFeeCents,
  };
}

export function tipCap(subtotal: number, policy: MoneyPolicy): number {
  return applyBps(subtotal, policy.tips.capBpsOfSubtotal);
}

/** Returns a human message when the tip is not allowed, else null. */
export function tipProblem(
  amountCents: number | null,
  b: BookingRow,
  policy: MoneyPolicy,
  now: Date,
): string | null {
  if (amountCents === null) return "Enter a dollar amount, e.g. 10 or 12.50";
  try {
    validateTip(
      amountCents,
      "card",
      Number(b.subtotal_cents),
      b.completed_at ? new Date(b.completed_at) : null,
      now,
      policy,
    );
    return null;
  } catch (e) {
    const msg = (e as Error).message;
    if (msg.startsWith("tip exceeds cap")) {
      const cap = tipCap(Number(b.subtotal_cents), policy);
      return `Tip can't be more than ${formatCents(cap)} (${policy.tips.capBpsOfSubtotal / 100}% of the ${formatCents(Number(b.subtotal_cents))} task subtotal)`;
    }
    return msg.charAt(0).toUpperCase() + msg.slice(1);
  }
}

export function previewRefund(
  kind: RefundKind,
  amountCents: number,
  actor: Actor,
  reason: string,
  approvedBy: string | undefined,
  b: BookingRow,
  tenders: TenderRow[],
  policy: MoneyPolicy,
  disputeOpen: boolean,
  now: Date,
): { plan: RefundPlan | null; error: string | null; refundable: number } {
  const paid = paidParts(tenders, false);
  const already = refundedParts(tenders);
  const refundable = partsTotal(paid) - partsTotal(already);
  const subtotal = Number(b.subtotal_cents);
  try {
    const plan = planRefund(
      {
        kind,
        amountCents: kind === "full" ? Math.max(refundable, 1) : amountCents,
        actor,
        approvedBy: approvedBy || undefined,
        reason,
        requestedAt: now,
      },
      {
        paid,
        alreadyRefunded: already,
        completedAt: b.completed_at ? new Date(b.completed_at) : null,
        subtotal,
        total: Number(b.total_cents),
        taskerCommissionOnSubtotal: applyBps(subtotal, policy.taskerCommissionBps),
        taskerPaidOut: false,
        disputeOpen,
      },
      policy,
    );
    return { plan, error: null, refundable };
  } catch (e) {
    return { plan: null, error: (e as Error).message, refundable };
  }
}

export const TENDER_LABEL: Record<keyof TenderParts, string> = {
  card: "Card",
  points: "Points",
  wallet: "Wallet",
  promo: "Promo credit",
};

/**
 * Points summary from the user's lots. "debt" lots (negative balance left by a clawback that
 * exceeded what the user had) are always available and reduce the spendable balance.
 */
export function pointsSummary(rows: PointsLotRow[], now: Date) {
  const lots: PointsLot[] = rows
    .filter((r) => r.kind !== "debt" && r.points_remaining > 0)
    .map((r) => ({
      id: r.id,
      kind: r.kind as PointsLot["kind"],
      points: r.points_remaining,
      availableAt: new Date(r.available_at),
      expiresAt: new Date(r.expires_at),
    }));
  const debt = rows
    .filter((r) => r.kind === "debt")
    .reduce((a, r) => a + Number(r.points_remaining), 0);
  const available = availablePoints(lots, now);
  return {
    lots,
    debt,
    available,
    availableNet: available + debt,
    pending: pendingPoints(lots, now),
  };
}
