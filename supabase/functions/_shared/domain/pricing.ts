import { applyBps, assertCents, Cents, divRoundHalfUp } from "./money.ts";
import { MoneyPolicy } from "./config.ts";

export interface Quote {
  rateCents: Cents;
  minutes: number;
  subtotal: Cents; // tasker rate x time
  serviceFee: Cents; // client service fee
  tax: Cents;
  total: Cents; // what the client pays (excluding tips)
  taskerCommission: Cents;
  taskerNet: Cents; // subtotal - commission
  platformRevenue: Cents; // serviceFee + commission
}

export function laborCents(rateCents: Cents, minutes: number): Cents {
  assertCents(rateCents, "rateCents");
  if (!Number.isInteger(minutes) || minutes <= 0)
    throw new Error("minutes must be a positive integer");
  return divRoundHalfUp(rateCents * minutes, 60);
}

export function quote(
  rateCents: Cents,
  minutes: number,
  policy: MoneyPolicy,
  discountCents: Cents = 0,
): Quote {
  const subtotal = laborCents(rateCents, minutes);
  const serviceFee = applyBps(subtotal, policy.clientServiceFeeBps);
  const tax = applyBps(subtotal + serviceFee, policy.taxBps);
  const total = subtotal + serviceFee + tax;
  const taskerCommission = applyBps(subtotal, policy.taskerCommissionBps);
  if (discountCents < 0 || discountCents > total) throw new Error("invalid discount");
  return {
    rateCents,
    minutes,
    subtotal,
    serviceFee,
    tax,
    total,
    taskerCommission,
    taskerNet: subtotal - taskerCommission,
    platformRevenue: serviceFee + taskerCommission,
  };
}
