import { Cents } from "./money.ts";
import { MoneyPolicy } from "./config.ts";
import { addDays } from "./time.ts";

export interface EarningItem {
  bookingId: string;
  netCents: Cents; // tasker net for the booking (after commission, clawbacks)
  completedAt: Date;
  cardSettled: boolean; // ACH/card funds final
  paidOut: boolean;
}

export interface PayoutPlan {
  amountCents: Cents;
  bookingIds: string[];
  blockedReason?: string;
}

export function planPayout(
  items: EarningItem[],
  balanceAdjustmentsCents: Cents,
  taskerStatus: string,
  now: Date,
  policy: MoneyPolicy,
): PayoutPlan {
  if (taskerStatus !== "active")
    return { amountCents: 0, bookingIds: [], blockedReason: `tasker is ${taskerStatus}` };
  const eligible = items.filter(
    (i) => !i.paidOut && i.cardSettled && addDays(i.completedAt, policy.payouts.holdDays) <= now,
  );
  const gross = eligible.reduce((a, i) => a + i.netCents, 0);
  const amount = gross + balanceAdjustmentsCents; // adjustments are negative for clawbacks/disputes/fees
  if (amount <= 0)
    return { amountCents: 0, bookingIds: [], blockedReason: "balance is zero or negative" };
  return { amountCents: amount, bookingIds: eligible.map((i) => i.bookingId) };
}
