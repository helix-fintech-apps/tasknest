import { applyBps, MoneyPolicy } from "./domain/index.ts";
import { BookingRow } from "./db.ts";

/** Money figures of a booking including extras charged at completion (inputs to planRefund / disputeLost). */
export function bookingFigures(b: BookingRow, policy: MoneyPolicy) {
  const commission = applyBps(Number(b.subtotal_cents), policy.taskerCommissionBps);
  const extraCommission = applyBps(Number(b.extra_labor_cents), policy.taskerCommissionBps);
  return {
    subtotal: Number(b.subtotal_cents) + Number(b.extra_labor_cents) + Number(b.expenses_cents),
    total: Number(b.total_cents) + Number(b.extra_cents),
    tax: Number(b.tax_cents) + Number(b.extra_tax_cents),
    commission: commission + extraCommission,
    baseCommission: commission,
  };
}
