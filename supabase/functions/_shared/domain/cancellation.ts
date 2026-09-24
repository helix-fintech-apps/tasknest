// Cancellation curve, provider (tasker) cancellations and no-shows.

import { applyBps, Cents } from "./money.ts";
import { MoneyPolicy } from "./config.ts";
import { hoursBetween } from "./time.ts";
import { laborCents } from "./pricing.ts";

export interface BookingMoney {
  rateCents: Cents;
  subtotal: Cents;
  serviceFee: Cents;
  tax: Cents;
  total: Cents;
  /** The start time the cutoff is measured from. Reschedules keep the ORIGINAL start (anti-gaming). */
  cutoffAnchorAt: Date;
}

export interface CancellationOutcome {
  tierIndex: number; // -1 for provider cancel / no-show rules
  hoursBefore: number;
  retainedCents: Cents; // kept from the client (fee)
  refundCents: Cents; // returned to the client
  taskerPayCents: Cents; // paid to the tasker out of the retained amount
  platformCents: Cents; // platform keeps
}

/** Client cancels. Tiers are evaluated from highest minHoursBefore; boundary is inclusive (>=). */
export function clientCancellation(
  b: BookingMoney,
  cancelAt: Date,
  policy: MoneyPolicy,
): CancellationOutcome {
  const hoursBefore = hoursBetween(cancelAt, b.cutoffAnchorAt);
  const tiers = [...policy.cancellation.tiers].sort((a, z) => z.minHoursBefore - a.minHoursBefore);
  let tierIndex = tiers.findIndex((t) => hoursBefore >= t.minHoursBefore);
  if (tierIndex === -1) tierIndex = tiers.length - 1; // after start: last tier applies
  const tier = tiers[tierIndex];

  let retained: Cents;
  let taskerPay: Cents;
  if (tier.chargeMinutesOfRate) {
    // Charge a fixed amount of the tasker's time, capped at the task subtotal. Fee goes to the tasker
    // (less commission); the client's service fee and tax are refunded.
    const fee = Math.min(laborCents(b.rateCents, tier.chargeMinutesOfRate), b.subtotal);
    retained = fee;
    taskerPay = fee - applyBps(fee, policy.taskerCommissionBps);
  } else {
    const refundBase = policy.cancellation.serviceFeeRefundable ? b.total : b.subtotal + b.tax;
    const refund = applyBps(refundBase, tier.refundBps);
    retained = b.total - refund;
    // The tasker is paid (less commission) for the labor that is NOT refunded. The retained part of the
    // service fee and tax is not labor: it stays with the platform.
    const retainedLabor = Math.max(
      0,
      Math.min(retained, b.subtotal - applyBps(b.subtotal, tier.refundBps)),
    );
    taskerPay = retainedLabor - applyBps(retainedLabor, policy.taskerCommissionBps);
  }
  return {
    tierIndex,
    hoursBefore,
    retainedCents: retained,
    refundCents: b.total - retained,
    taskerPayCents: Math.max(0, taskerPay),
    platformCents: retained - Math.max(0, taskerPay),
  };
}

/** Tasker cancels or no-shows: client always gets 100% back including fees. Tasker gets a strike + fee. */
export function taskerCancellation(
  b: BookingMoney,
  policy: MoneyPolicy,
): CancellationOutcome & { taskerFeeCents: Cents } {
  return {
    tierIndex: -1,
    hoursBefore: NaN,
    retainedCents: 0,
    refundCents: b.total,
    taskerPayCents: 0,
    platformCents: 0,
    taskerFeeCents: policy.taskerPenalty.cancelFeeCents,
  };
}

/** Client no-show: refund per policy (default 0%). */
export function clientNoShow(b: BookingMoney, policy: MoneyPolicy): CancellationOutcome {
  const refund = applyBps(b.total, policy.cancellation.noShowRefundBps);
  const retained = b.total - refund;
  // Only the labor that is not refunded is paid to the tasker (never the service fee or tax).
  const labor = Math.min(
    retained,
    b.subtotal - applyBps(b.subtotal, policy.cancellation.noShowRefundBps),
  );
  const taskerPay = labor - applyBps(labor, policy.taskerCommissionBps);
  return {
    tierIndex: -1,
    hoursBefore: NaN,
    retainedCents: retained,
    refundCents: refund,
    taskerPayCents: taskerPay,
    platformCents: retained - taskerPay,
  };
}

/** Strikes within the window; returns whether the tasker should be suspended. */
export function shouldSuspend(strikeTimes: Date[], now: Date, policy: MoneyPolicy): boolean {
  const windowStart = now.getTime() - policy.taskerPenalty.strikeWindowDays * 86_400_000;
  const recent = strikeTimes.filter((t) => t.getTime() >= windowStart).length;
  return recent >= policy.taskerPenalty.strikesToSuspend;
}
