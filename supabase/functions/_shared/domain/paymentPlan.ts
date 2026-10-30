// Payment plan for a booking: when the card is held. Server-chosen at booking time (docs/contracts.md 4.2).
//
//   hold_now              place the manual-capture hold now (start is soon, inside the 7-day on-session window)
//   save_card_hold_later  save the card now and place the hold `scheduledHoldLeadHours` before the start
//   card_not_needed       points, promo and wallet cover the whole total; nothing to hold
//
// Policies without the v2 `auth.*` fields (v1) always hold now, exactly as before.

import { Cents } from "./money.ts";
import { MoneyPolicy } from "./config.ts";
import { hoursBetween } from "./time.ts";

export type PaymentMode = "hold_now" | "save_card_hold_later" | "card_not_needed";

export interface PaymentPlan {
  mode: PaymentMode;
  cardCents: Cents;
  /** When the scheduled hold is placed (save_card_hold_later only). */
  holdAt: Date | null;
  reason: string;
  /** True for v1 policies: the hold is the old 7-day authorization, tracked by auth_expires_at. */
  legacy: boolean;
}

export function planPayment(
  input: { startAt: Date; now: Date; cardCents: Cents },
  policy: MoneyPolicy,
): PaymentPlan {
  const { startAt, now, cardCents } = input;
  const legacy = policy.auth.holdNowMaxHoursBeforeStart === undefined;
  if (cardCents <= 0) {
    return {
      mode: "card_not_needed",
      cardCents: 0,
      holdAt: null,
      reason: "Points and credits cover the whole total, so no card hold is placed.",
      legacy,
    };
  }
  const maxHours = policy.auth.holdNowMaxHoursBeforeStart;
  if (maxHours === undefined || hoursBetween(now, startAt) <= maxHours) {
    return {
      mode: "hold_now",
      cardCents,
      holdAt: null,
      reason: "The task is soon, so the hold is placed now. It is a hold, not a charge.",
      legacy,
    };
  }
  const lead = policy.auth.scheduledHoldLeadHours ?? 48;
  return {
    mode: "save_card_hold_later",
    cardCents,
    holdAt: new Date(startAt.getTime() - lead * 3_600_000),
    reason: `The task is more than ${maxHours} hours away. Your card is saved now and the hold is placed ${lead} hours before the start.`,
    legacy,
  };
}

/**
 * A hold must outlive the task: re-hold when `capture_before` falls before start + estimate + buffer.
 * Always trust the `capture_before` Stripe reports on the charge, never a computed expiry.
 */
export function needsRehold(
  captureBefore: Date,
  startAt: Date,
  estMinutes: number,
  policy: MoneyPolicy,
): boolean {
  const buffer = (policy.auth.captureBufferHours ?? 24) * 3_600_000;
  return captureBefore.getTime() < startAt.getTime() + estMinutes * 60_000 + buffer;
}

/** The new `hold_at` after a reschedule: lead hours before the new start, never in the past. */
export function holdAtAfterReschedule(newStartAt: Date, now: Date, policy: MoneyPolicy): Date {
  const lead = (policy.auth.scheduledHoldLeadHours ?? 48) * 3_600_000;
  return new Date(Math.max(newStartAt.getTime() - lead, now.getTime()));
}
