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
  clientServiceFeeBps: number; // added to the client's total
  taskerCommissionBps: number; // deducted from the tasker's earnings
  taxBps: number; // tax on (subtotal + service fee)
  cancellation: {
    tiers: CancellationTier[]; // highest minHoursBefore first
    noShowRefundBps: number; // client no-show
    serviceFeeRefundable: boolean; // is the client service fee refunded on cancellation?
  };
  taskerPenalty: {
    cancelFeeCents: number;
    strikesToSuspend: number;
    strikeWindowDays: number;
  };
  /** Policy v2+. Absent in v1, which keeps v1 behaviour (no card minimum). */
  card?: {
    /** The card share of a booking is 0 or at least this many cents (Stripe's USD minimum charge is 50). */
    minChargeCents: number;
  };
  tips: {
    capBpsOfSubtotal: number; // max tip as share of task subtotal
    windowDays: number; // days after completion a tip is allowed
    platformFeeBps: number; // must be 0: tips pass through 100%
    allowedTenders: Tender[]; // tips are cash only
    /** Policy v2+: smallest tip in cents (a tip is a card charge, so it must be chargeable). */
    minCents?: number;
  };
  /** Policy v2+: the card charge for extras at completion is 0 or at least this many cents. */
  extras?: { minCardChargeCents: number };
  points: {
    centsPerPoint: number;
    pointsPerDollarCash: number; // earned on card cash paid, excluding tax and tips
    minRedeemPoints: number;
    maxRedeemBpsOfTotal: number;
    pendingDays: number; // earned points pending until completion + N days
    expiryMonths: number;
    reissueDaysOnExpiredRefund: number;
    reviewBonusPoints: number;
  };
  tenderUseOrder: Tender[]; // order tenders are applied at checkout
  refundOrder: Tender[]; // order partial refunds go back
  retentionOrder: Tender[]; // which tender a cancellation fee is taken from first
  payouts: { holdDays: number };
  refunds: { agentLimitCents: number; windowDays: number; providerShare: "proportional" };
  auth: {
    validityDays: number;
    reauthBufferDays: number;
    /** Policy v2+: `hold_now` when the start is at most this many hours away (inside the 7-day on-session window). */
    holdNowMaxHoursBeforeStart?: number;
    /** Policy v2+: a scheduled hold is placed this many hours before the start (`hold_at`). */
    scheduledHoldLeadHours?: number;
    /** Policy v2+: re-hold when the hold's capture_before is earlier than start + estimate + this many hours. */
    captureBufferHours?: number;
  };
  booking: { taskerResponseHours: number };
  /** Policy v2+: the card-consent text version the client must accept to save a card. */
  consent?: { textVersion: string };
}

/**
 * Card-consent texts by version. The server records the version and the SHA-256 of this exact text in
 * `card_consents`; the checkout UI shows it. Stripe requires stated terms, explicit consent and a record
 * for off-session charges. Needs owner/legal approval before real launch (plan decision D8).
 */
export const CARD_CONSENT_TEXTS: Record<string, string> = {
  "card-consent-v1":
    "Save this card to my TaskNest account. I allow TaskNest to place and re-place the hold for this task, and to charge it for extra time and expenses, cancellation or no-show fees under the published policy, and tips I choose.",
};

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

/**
 * Money policy v2 (seeded by migration 20261101000100). Everything not listed below is copied from v1, so
 * quotes, fees, the cancellation curve and payouts do not move; v2 adds the card minimum, the tip and extras
 * minimums, and the hold-timing rules behind `planPayment`.
 */
export const POLICY_V2: MoneyPolicy = {
  ...DEFAULT_POLICY,
  version: 2,
  card: { minChargeCents: 50 },
  tips: { ...DEFAULT_POLICY.tips, minCents: 50 },
  extras: { minCardChargeCents: 50 },
  auth: {
    ...DEFAULT_POLICY.auth,
    holdNowMaxHoursBeforeStart: 96,
    scheduledHoldLeadHours: 48,
    captureBufferHours: 24,
  },
  consent: { textVersion: "card-consent-v1" },
};
