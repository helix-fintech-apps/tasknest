// Loyalty points: earn on card cash, pending -> available, reserve/redeem, clawback, expiry.

import { Cents } from "./money.ts";
import { MoneyPolicy } from "./config.ts";
import { addDays, addMonths } from "./time.ts";

export type LotKind = "earn" | "bonus" | "reissue";

export interface PointsLot {
  id: string;
  kind: LotKind;
  points: number; // remaining points in the lot
  availableAt: Date; // pending until this time
  expiresAt: Date;
}

/**
 * Points earned on a booking. Base = card cash paid for the task, excluding tax and tips.
 * Points, wallet and promo credit never earn points.
 */
export function pointsEarned(
  cardPaid: Cents,
  taxOnBooking: Cents,
  bookingTotal: Cents,
  policy: MoneyPolicy,
): number {
  if (cardPaid <= 0 || bookingTotal <= 0) return 0;
  // Tax is allocated to the card in proportion to the card's share of the total.
  const taxOnCard = Math.floor((taxOnBooking * cardPaid) / bookingTotal);
  const base = cardPaid - taxOnCard;
  return Math.floor(base / 100) * policy.points.pointsPerDollarCash;
}

export function newEarnLot(
  id: string,
  points: number,
  completedAt: Date,
  policy: MoneyPolicy,
): PointsLot {
  const availableAt = addDays(completedAt, policy.points.pendingDays);
  return {
    id,
    kind: "earn",
    points,
    availableAt,
    expiresAt: addMonths(availableAt, policy.points.expiryMonths),
  };
}

export function availablePoints(lots: PointsLot[], now: Date): number {
  return lots
    .filter((l) => l.availableAt <= now && l.expiresAt > now)
    .reduce((a, l) => a + l.points, 0);
}

export function pendingPoints(lots: PointsLot[], now: Date): number {
  return lots.filter((l) => l.availableAt > now).reduce((a, l) => a + l.points, 0);
}

/** Take points from available lots, soonest-expiring first. Returns the lots consumed. */
export function consumeFifo(
  lots: PointsLot[],
  points: number,
  now: Date,
): { lotId: string; points: number }[] {
  if (points > availablePoints(lots, now)) throw new Error("not enough available points");
  const usable = lots
    .filter((l) => l.availableAt <= now && l.expiresAt > now)
    .sort((a, b) => +a.expiresAt - +b.expiresAt);
  const taken: { lotId: string; points: number }[] = [];
  let left = points;
  for (const l of usable) {
    if (left === 0) break;
    const take = Math.min(l.points, left);
    taken.push({ lotId: l.id, points: take });
    l.points -= take;
    left -= take;
  }
  return taken;
}

/**
 * Points to claw back when card cash on a booking is refunded or disputed.
 * Proportional to the card amount reversed, rounded UP so partial refunds can't leave free points.
 */
export function clawbackPoints(earned: number, cardPaid: Cents, cardReversed: Cents): number {
  if (earned <= 0 || cardPaid <= 0 || cardReversed <= 0) return 0;
  return Math.min(earned, Math.ceil((earned * cardReversed) / cardPaid));
}

/** Refund of points spent on a booking. Expired points are reissued with a short expiry. */
export function pointsToReturn(
  redeemedFrom: { points: number; expiresAt: Date }[],
  now: Date,
  policy: MoneyPolicy,
): { points: number; expiresAt: Date }[] {
  return redeemedFrom.map((r) =>
    r.expiresAt > now
      ? r
      : { points: r.points, expiresAt: addDays(now, policy.points.reissueDaysOnExpiredRefund) },
  );
}
