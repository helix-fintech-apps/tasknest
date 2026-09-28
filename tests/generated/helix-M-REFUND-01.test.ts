// HELIX-GENERATED TEST — rule M-REFUND-01 (service-marketplace playbook)
// Invariant (refunds.planRefund): a partial refund splits back across exactly the tenders that
// paid, never returning more to a tender than it received (net of prior refunds), with the parts
// summing to the refund amount (no money created or lost); and the tasker clawback plus the
// platform cost equal the refund, with the clawback never exceeding the tasker's proportional
// share of the refunded amount (the tasker is never over-clawed).
import {
  DEFAULT_POLICY as P,
  planRefund,
  partsTotal,
} from "../../supabase/functions/_shared/domain/index.ts";

describe("M-REFUND-01 — refunds.planRefund (per-tender split + tasker clawback)", () => {
  // A 2h @ $45/h booking paid across all four tenders: subtotal 9000, service fee 1350,
  // total 10350, tasker net 7650 (commission 1350 of subtotal).
  const paid = { card: 7350, wallet: 500, points: 1500, promo: 1000 }; // sums to 10350
  const ctx = {
    paid,
    alreadyRefunded: { card: 0, wallet: 0, points: 0, promo: 0 },
    completedAt: new Date("2026-09-20T12:00:00Z"),
    subtotal: 9000,
    total: 10350,
    taskerCommissionOnSubtotal: 1350,
    taskerPaidOut: false,
    disputeOpen: false,
  };

  it("splits a partial refund across tenders and bounds the tasker clawback", () => {
    const amount = 8000; // spans card -> wallet -> points

    const plan = planRefund(
      {
        kind: "partial",
        amountCents: amount,
        actor: "support_agent",
        reason: "helix invariant probe",
        requestedAt: new Date("2026-09-21T12:00:00Z"),
      },
      ctx,
      P,
    );

    // (1) conservation: per-tender parts sum exactly to the refund amount.
    expect(partsTotal(plan.perTender)).toBe(amount);

    // (2) per-tender bound: never refund a tender more than it paid (net of prior refunds).
    for (const t of ["card", "wallet", "points", "promo"] as const) {
      expect(plan.perTender[t]).toBeLessThanOrEqual(paid[t] - ctx.alreadyRefunded[t]);
    }

    // (3) full attribution + no over-clawback of the tasker's proportional share.
    expect(plan.taskerClawbackCents + plan.platformCostCents).toBe(amount);
    const taskerShareCap = Math.ceil(
      (amount * (ctx.subtotal - ctx.taskerCommissionOnSubtotal)) / ctx.total,
    );
    expect(plan.taskerClawbackCents).toBeGreaterThanOrEqual(0);
    expect(plan.taskerClawbackCents).toBeLessThanOrEqual(taskerShareCap);
  });
});
