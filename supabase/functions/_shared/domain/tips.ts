import { Cents, applyBps } from "./money.ts";
import { MoneyPolicy, Tender } from "./config.ts";
import { addDays } from "./time.ts";

export interface TipCheck { taskerGets: Cents; platformFee: Cents }

/** Tips: cash only, capped, within the window after completion, 100% to the tasker. */
export function validateTip(amount: Cents, tender: Tender, subtotal: Cents, completedAt: Date | null, now: Date, policy: MoneyPolicy): TipCheck {
  if (!Number.isInteger(amount) || amount <= 0) throw new Error("tip must be a positive amount");
  if (!completedAt) throw new Error("tips are allowed only after the task is completed");
  if (now > addDays(completedAt, policy.tips.windowDays)) throw new Error("tip window has closed");
  if (!policy.tips.allowedTenders.includes(tender)) throw new Error("tips must be paid by card");
  const cap = applyBps(subtotal, policy.tips.capBpsOfSubtotal);
  if (amount > cap) throw new Error(`tip exceeds cap of ${cap}`);
  const platformFee = applyBps(amount, policy.tips.platformFeeBps);
  return { taskerGets: amount - platformFee, platformFee };
}
