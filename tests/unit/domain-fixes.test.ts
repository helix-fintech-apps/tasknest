// Regression tests for domain bugs found while building the API.

import {
  DEFAULT_POLICY as P,
  clientCancellation,
  clientNoShow,
  planRefund,
} from "../../supabase/functions/_shared/domain/index.ts";

const H = 3_600_000;

describe("cancellation pay split (tasker is paid only for unrefunded labor)", () => {
  const start = new Date("2026-11-10T17:00:00Z");
  const b = {
    rateCents: 4500,
    subtotal: 9000,
    serviceFee: 1350,
    tax: 0,
    total: 10350,
    cutoffAnchorAt: start,
  };

  it("50% tier: half the labor less commission to the tasker; the retained service fee stays with the platform", () => {
    const o = clientCancellation(b, new Date(start.getTime() - 30 * H), P);
    expect(o.refundCents).toBe(5175);
    expect(o.retainedCents).toBe(5175);
    expect(o.taskerPayCents).toBe(3825); // 4500 labor - 15% commission (was 4399: 85% of labor + fee)
    expect(o.platformCents).toBe(1350); // 675 retained service fee + 675 commission
  });

  it("never pays the tasker any retained tax", () => {
    const taxed = { ...P, taxBps: 1000 };
    const tb = { ...b, tax: 1035, total: 11385 };
    const o = clientCancellation(tb, new Date(start.getTime() - 30 * H), taxed);
    expect(o.taskerPayCents).toBe(3825);
    expect(o.taskerPayCents + o.platformCents).toBe(o.retainedCents);
  });

  it("100% tier pays the tasker nothing", () => {
    const o = clientCancellation(b, new Date(start.getTime() - 72 * H), P);
    expect(o).toMatchObject({
      refundCents: 10350,
      retainedCents: 0,
      taskerPayCents: 0,
      platformCents: 0,
    });
  });

  it("client no-show with a partial refund pays the tasker only for the unrefunded labor", () => {
    const o = clientNoShow(b, { ...P, cancellation: { ...P.cancellation, noShowRefundBps: 5000 } });
    expect(o.refundCents).toBe(5175);
    expect(o.taskerPayCents).toBe(3825);
    expect(o.platformCents).toBe(1350);
    expect(clientNoShow(b, P).taskerPayCents).toBe(7650); // default policy: nothing refunded
  });
});

describe("refund planning", () => {
  it("rejects a full refund when nothing is left to refund (was an all-zero plan)", () => {
    const paid = { card: 7350, points: 3000, wallet: 0, promo: 0 };
    const ctx = {
      paid,
      alreadyRefunded: { ...paid },
      completedAt: new Date("2026-11-10T19:00:00Z"),
      subtotal: 9000,
      total: 10350,
      taskerCommissionOnSubtotal: 1350,
      taskerPaidOut: false,
      disputeOpen: false,
    };
    const req = {
      kind: "full" as const,
      amountCents: 1,
      actor: "admin" as const,
      reason: "again",
      requestedAt: new Date("2026-11-12T00:00:00Z"),
    };
    expect(() => planRefund(req, ctx, P)).toThrow(/nothing left to refund/);
  });
});
