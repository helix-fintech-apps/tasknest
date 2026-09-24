// Money policy. The same values are stored in the `money_policies` table (versioned).
// A booking snapshots the policy version it was created under; later changes never apply retroactively.

export type Tender = "card" | "points" | "wallet" | "promo";

export interface CancellationTier {
  /** Tier applies when hours-before-start >= minHoursBefore. Tiers are checked from highest to lowest. */
  minHoursBefore: number;
  /** Share of the booking total refunded to the client, in basis points. */
  refundBps: number;
  /** If set, the client is charged this many minutes of the tasker's rate instead of a percentage. */
  chargeMinutesOfRate?: number;
}

export interface MoneyPolicy {
  version: number;
  currency: "USD";
  clientServiceFeeBps: number;     // added to the client's total
  taskerCommissionBps: number;     // deducted from the tasker's earnings
  taxBps: number;                  // tax on (subtotal + service fee)
  cancellation: {
    tiers: CancellationTier[];     // highest minHoursBefore first
    noShowRefundBps: number;       // client no-show
    serviceFeeRefundable: boolean; // is the client service fee refunded on cancellation?
  };
  taskerPenalty: {
    cancelFeeCents: number;
    strikesToSuspend: number;
    strikeWindowDays: number;
  };
  tips: {
    capBpsOfSubtotal: number;      // max tip as share of task subtotal
    windowDays: number;            // days after completion a tip is allowed
    platformFeeBps: number;        // must be 0: tips pass through 100%
    allowedTenders: Tender[];      // tips are cash only
  };
  points: {
    centsPerPoint: number;
    pointsPerDollarCash: number;   // earned on card cash paid, excluding tax and tips
    minRedeemPoints: number;
    maxRedeemBpsOfTotal: number;
    pendingDays: number;           // earned points pending until completion + N days
    expiryMonths: number;
    reissueDaysOnExpiredRefund: number;
    reviewBonusPoints: number;
  };
  tenderUseOrder: Tender[];        // order tenders are applied at checkout
  refundOrder: Tender[];           // order partial refunds go back
  retentionOrder: Tender[];        // which tender a cancellation fee is taken from first
  payouts: { holdDays: number };
  refunds: { agentLimitCents: number; windowDays: number; providerShare: "proportional" };
  auth: { validityDays: number; reauthBufferDays: number };
  booking: { taskerResponseHours: number };
}

export const DEFAULT_POLICY: MoneyPolicy = {
  version: 1,
  currency: "USD",
  clientServiceFeeBps: 1500,
  taskerCommissionBps: 1500,
  taxBps: 0,
  cancellation: {
    tiers: [
      { minHoursBefore: 48, refundBps: 10_000 },
      { minHoursBefore: 24, refundBps: 5_000 },
      { minHoursBefore: 0, refundBps: 0, chargeMinutesOfRate: 60 },
    ],
    noShowRefundBps: 0,
    serviceFeeRefundable: true,
  },
  taskerPenalty: { cancelFeeCents: 1_000, strikesToSuspend: 3, strikeWindowDays: 30 },
  tips: { capBpsOfSubtotal: 2_500, windowDays: 30, platformFeeBps: 0, allowedTenders: ["card"] },
  points: {
    centsPerPoint: 1,
    pointsPerDollarCash: 1,
    minRedeemPoints: 500,
    maxRedeemBpsOfTotal: 10_000,
    pendingDays: 7,
    expiryMonths: 12,
    reissueDaysOnExpiredRefund: 30,
    reviewBonusPoints: 100,
  },
  tenderUseOrder: ["promo", "points", "wallet", "card"],
  refundOrder: ["card", "wallet", "points", "promo"],
  retentionOrder: ["card", "wallet", "points", "promo"],
  payouts: { holdDays: 3 },
  refunds: { agentLimitCents: 10_000, windowDays: 30, providerShare: "proportional" },
  auth: { validityDays: 7, reauthBufferDays: 1 },
  booking: { taskerResponseHours: 24 },
};
