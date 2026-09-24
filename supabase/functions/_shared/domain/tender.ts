// Split-tender allocation: promo credit, loyalty points, wallet balance and card.

import { Cents, applyBps } from "./money.ts";
import { MoneyPolicy, Tender } from "./config.ts";

export interface TenderParts {
  card: Cents;
  points: Cents;   // cash value of points used
  wallet: Cents;
  promo: Cents;
}

export interface Allocation {
  parts: TenderParts;
  pointsUsed: number; // number of points (not cents)
}

export interface Available {
  promoCents: Cents;
  walletCents: Cents;
  pointsBalance: number;   // available (not pending, not reserved) points
  pointsRequested: number; // how many points the client chose to use (0 = none)
}

export const emptyParts = (): TenderParts => ({ card: 0, points: 0, wallet: 0, promo: 0 });

export function partsTotal(p: TenderParts): Cents {
  return p.card + p.points + p.wallet + p.promo;
}

/**
 * Allocate a booking total across tenders in the policy's use order.
 * Rules: points must meet the minimum, can't exceed the balance or the redeem cap,
 * and are used in whole points. The card covers whatever is left (never negative).
 */
export function allocateTenders(total: Cents, avail: Available, policy: MoneyPolicy): Allocation {
  if (total < 0) throw new Error("total must be >= 0");
  const parts = emptyParts();
  let remaining = total;
  let pointsUsed = 0;

  for (const tender of policy.tenderUseOrder) {
    if (remaining === 0) break;
    if (tender === "promo") {
      parts.promo = Math.min(avail.promoCents, remaining);
      remaining -= parts.promo;
    } else if (tender === "wallet") {
      parts.wallet = Math.min(avail.walletCents, remaining);
      remaining -= parts.wallet;
    } else if (tender === "points") {
      const req = avail.pointsRequested;
      if (req <= 0) continue;
      if (req < policy.points.minRedeemPoints) throw new Error(`minimum redemption is ${policy.points.minRedeemPoints} points`);
      if (req > avail.pointsBalance) throw new Error("not enough available points");
      const capCents = applyBps(total, policy.points.maxRedeemBpsOfTotal);
      const maxCents = Math.min(remaining, capCents);
      const maxPoints = Math.floor(maxCents / policy.points.centsPerPoint);
      pointsUsed = Math.min(req, maxPoints);
      parts.points = pointsUsed * policy.points.centsPerPoint;
      remaining -= parts.points;
    }
  }
  parts.card = remaining;
  return { parts, pointsUsed };
}

/**
 * Split a refund across tenders in `order`, never refunding more to a tender than
 * was paid with it (net of earlier refunds).
 */
export function splitRefund(
  amount: Cents,
  paid: TenderParts,
  alreadyRefunded: TenderParts,
  order: Tender[],
): TenderParts {
  const out = emptyParts();
  let remaining = amount;
  const refundable = partsTotal(paid) - partsTotal(alreadyRefunded);
  if (amount < 0) throw new Error("refund must be >= 0");
  if (amount > refundable) throw new Error(`refund ${amount} exceeds refundable ${refundable}`);
  for (const t of order) {
    const room = paid[t] - alreadyRefunded[t];
    const take = Math.min(room, remaining);
    out[t] = take;
    remaining -= take;
  }
  return out;
}

/**
 * For a cancellation that retains `retained` cents (a fee), work out how much of each
 * tender is kept (taken from tenders in retentionOrder) and refund the rest.
 */
export function refundAfterRetention(paid: TenderParts, retained: Cents, policy: MoneyPolicy): { kept: TenderParts; refund: TenderParts } {
  const kept = emptyParts();
  let remaining = Math.min(retained, partsTotal(paid));
  for (const t of policy.retentionOrder) {
    const take = Math.min(paid[t], remaining);
    kept[t] = take;
    remaining -= take;
  }
  const refund: TenderParts = {
    card: paid.card - kept.card,
    points: paid.points - kept.points,
    wallet: paid.wallet - kept.wallet,
    promo: paid.promo - kept.promo,
  };
  return { kept, refund };
}
