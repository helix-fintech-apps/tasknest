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

export interface ExtrasFigures {
  extraMinutes: number;
  expensesCents: Cents;
  extraLaborCents: Cents;
  extraFeeCents: Cents; // client service fee on the extra labor
  extraTaxCents: Cents;
  /** Card charge for the extras: labor + fee + tax + expenses. Expenses carry no fee or commission. */
  totalCents: Cents;
  commissionCents: Cents; // tasker commission on the extra labor
  taskerPayCents: Cents; // labor - commission + expenses
  platformCents: Cents; // fee + commission
  /** Set when the policy forbids this charge (v2: a card charge of 1..49 cents). */
  problem?: string;
}

/** What completing a booking with extra time and expenses costs, split between tasker and platform. */
export function extrasFigures(
  rateCents: Cents,
  extraMinutes: number,
  expensesCents: Cents,
  policy: MoneyPolicy,
): ExtrasFigures {
  assertCents(expensesCents, "expensesCents");
  if (expensesCents < 0) throw new Error("expensesCents must be >= 0");
  if (!Number.isInteger(extraMinutes) || extraMinutes < 0)
    throw new Error("extraMinutes must be a non-negative integer");
  const xq = extraMinutes > 0 ? quote(rateCents, extraMinutes, policy) : null;
  const extraLaborCents = xq?.subtotal ?? 0;
  const extraFeeCents = xq?.serviceFee ?? 0;
  const extraTaxCents = xq?.tax ?? 0;
  const commissionCents = applyBps(extraLaborCents, policy.taskerCommissionBps);
  const totalCents = extraLaborCents + extraFeeCents + extraTaxCents + expensesCents;
  const f: ExtrasFigures = {
    extraMinutes,
    expensesCents,
    extraLaborCents,
    extraFeeCents,
    extraTaxCents,
    totalCents,
    commissionCents,
    taskerPayCents: extraLaborCents - commissionCents + expensesCents,
    platformCents: extraFeeCents + commissionCents,
  };
  const problem = extrasProblem(totalCents, policy);
  if (problem) f.problem = problem;
  return f;
}

/** Policy v2: extras are charged to the card, so a charge of 1..min-1 cents is refused. Zero is fine. */
export function extrasProblem(cardCents: Cents, policy: MoneyPolicy): string | undefined {
  const min = policy.extras?.minCardChargeCents ?? 0;
  if (min > 0 && cardCents > 0 && cardCents < min) {
    return `extras of ${cardCents} cents are below the ${min}-cent card minimum; add more time or expenses, or none`;
  }
  return undefined;
}
