import {
  DEFAULT_POLICY as P,
  quote,
  allocateTenders,
  splitRefund,
  refundAfterRetention,
  partsTotal,
  clientCancellation,
  taskerCancellation,
  shouldSuspend,
  localToUtc,
  pointsEarned,
  clawbackPoints,
  consumeFifo,
  newEarnLot,
  availablePoints,
  pendingPoints,
  planRefund,
  disputeLost,
  validateTip,
  planPayout,
  txn,
  dr,
  cr,
  canTransition,
  needsReauth,
  promoDiscount,
  divRoundHalfUp,
} from "../../supabase/functions/_shared/domain/index.ts";

const H = 3_600_000;

describe("money helpers", () => {
  it("rounds half up", () => {
    expect(divRoundHalfUp(5, 2)).toBe(3);
    expect(divRoundHalfUp(4, 3)).toBe(1);
  });
});

describe("quote", () => {
  it("prices 2h at $45/h with 15% fee and commission", () => {
    const q = quote(4500, 120, P);
    expect(q.subtotal).toBe(9000);
    expect(q.serviceFee).toBe(1350);
    expect(q.total).toBe(10350);
    expect(q.taskerNet).toBe(7650);
    expect(q.platformRevenue).toBe(2700);
  });
  it("handles odd minutes without floats", () => {
    expect(quote(3333, 95, P).subtotal).toBe(5277); // 3333*95/60 = 5277.25
  });
});

describe("split tender", () => {
  it("uses promo -> points -> wallet -> card", () => {
    const a = allocateTenders(
      10350,
      { promoCents: 1000, walletCents: 500, pointsBalance: 2000, pointsRequested: 1500 },
      P,
    );
    expect(a.parts).toEqual({ promo: 1000, points: 1500, wallet: 500, card: 7350 });
    expect(partsTotal(a.parts)).toBe(10350);
    expect(a.pointsUsed).toBe(1500);
  });
  it("never makes the card negative and caps points at the remaining total", () => {
    const a = allocateTenders(
      800,
      { promoCents: 0, walletCents: 0, pointsBalance: 5000, pointsRequested: 5000 },
      P,
    );
    expect(a.parts.card).toBe(0);
    expect(a.pointsUsed).toBe(800);
  });
  it("rejects below-minimum redemptions", () => {
    expect(() =>
      allocateTenders(
        5000,
        { promoCents: 0, walletCents: 0, pointsBalance: 1000, pointsRequested: 100 },
        P,
      ),
    ).toThrow();
  });
  it("splits partial refunds card first and never over-refunds a tender", () => {
    const paid = { card: 6000, points: 4000, wallet: 0, promo: 0 };
    const first = splitRefund(
      7000,
      paid,
      { card: 0, points: 0, wallet: 0, promo: 0 },
      P.refundOrder,
    );
    expect(first).toEqual({ card: 6000, wallet: 0, points: 1000, promo: 0 });
    expect(() => splitRefund(3001, paid, first, P.refundOrder)).toThrow();
  });
  it("takes a cancellation fee from the card first", () => {
    const r = refundAfterRetention({ card: 3000, points: 4000, wallet: 0, promo: 0 }, 4500, P);
    expect(r.kept).toEqual({ card: 3000, points: 1500, wallet: 0, promo: 0 });
    expect(r.refund.points).toBe(2500);
  });
});

describe("cancellation curve", () => {
  const start = new Date("2026-11-10T17:00:00Z");
  const b = {
    rateCents: 4500,
    subtotal: 9000,
    serviceFee: 1350,
    tax: 0,
    total: 10350,
    cutoffAnchorAt: start,
  };
  it("full refund at exactly 48h (inclusive boundary)", () => {
    const o = clientCancellation(b, new Date(start.getTime() - 48 * H), P);
    expect(o.refundCents).toBe(10350);
  });
  it("50% just under 48h", () => {
    const o = clientCancellation(b, new Date(start.getTime() - 48 * H + 1000), P);
    expect(o.refundCents).toBe(5175);
  });
  it("charges one hour of rate under 24h", () => {
    const o = clientCancellation(b, new Date(start.getTime() - 3 * H), P);
    expect(o.retainedCents).toBe(4500);
    expect(o.refundCents).toBe(5850);
    expect(o.taskerPayCents).toBe(3825);
  });
  it("tasker cancel refunds everything and fines the tasker", () => {
    const o = taskerCancellation(b, P);
    expect(o.refundCents).toBe(10350);
    expect(o.taskerFeeCents).toBe(1000);
  });
  it("suspends at 3 strikes within 30 days", () => {
    const now = new Date("2026-11-30T00:00:00Z");
    const d = (n: number) => new Date(now.getTime() - n * 86_400_000);
    expect(shouldSuspend([d(1), d(10), d(29)], now, P)).toBe(true);
    expect(shouldSuspend([d(1), d(10), d(31)], now, P)).toBe(false);
  });
  it("converts local task time across DST correctly", () => {
    // US DST ends 2026-11-01. 09:00 in Los Angeles is 17:00Z after the change, 16:00Z before.
    expect(localToUtc("2026-11-02T09:00", "America/Los_Angeles").toISOString()).toBe(
      "2026-11-02T17:00:00.000Z",
    );
    expect(localToUtc("2026-10-30T09:00", "America/Los_Angeles").toISOString()).toBe(
      "2026-10-30T16:00:00.000Z",
    );
  });
});

describe("points", () => {
  it("earns only on card cash, excluding tax", () => {
    expect(pointsEarned(7350, 0, 10350, P)).toBe(73);
    expect(pointsEarned(0, 0, 10350, P)).toBe(0);
  });
  it("claws back proportionally, rounded up", () => {
    expect(clawbackPoints(73, 7350, 3675)).toBe(37);
    expect(clawbackPoints(73, 7350, 7350)).toBe(73);
  });
  it("keeps earned points pending for 7 days and spends soonest-expiring first", () => {
    const done = new Date("2026-01-01T00:00:00Z");
    const lots = [
      newEarnLot("a", 600, done, P),
      newEarnLot("b", 400, new Date("2025-06-01T00:00:00Z"), P),
    ];
    expect(pendingPoints(lots, new Date("2026-01-03T00:00:00Z"))).toBe(600);
    const now = new Date("2026-01-09T00:00:00Z");
    expect(availablePoints(lots, now)).toBe(1000);
    expect(consumeFifo(lots, 500, now)).toEqual([
      { lotId: "b", points: 400 },
      { lotId: "a", points: 100 },
    ]);
  });
});

describe("refunds and disputes", () => {
  const ctx = {
    paid: { card: 7350, points: 3000, wallet: 0, promo: 0 },
    alreadyRefunded: { card: 0, points: 0, wallet: 0, promo: 0 },
    completedAt: new Date("2026-11-10T19:00:00Z"),
    subtotal: 9000,
    total: 10350,
    taskerCommissionOnSubtotal: 1350,
    taskerPaidOut: false,
    disputeOpen: false,
  };
  const at = new Date("2026-11-12T00:00:00Z");
  it("partial refund splits card first and shares cost with the tasker", () => {
    const r = planRefund(
      {
        kind: "partial",
        amountCents: 2000,
        actor: "client",
        reason: "left early",
        requestedAt: at,
      },
      ctx,
      P,
    );
    expect(r.perTender.card).toBe(2000);
    expect(r.taskerClawbackCents).toBe(1478);
    expect(r.platformCostCents).toBe(522);
  });
  it("goodwill is absorbed by the platform", () => {
    const r = planRefund(
      {
        kind: "goodwill",
        amountCents: 1000,
        actor: "support_agent",
        reason: "late",
        requestedAt: at,
      },
      ctx,
      P,
    );
    expect(r.taskerClawbackCents).toBe(0);
  });
  it("agent refunds above the limit need approval", () => {
    expect(() =>
      planRefund(
        {
          kind: "partial",
          amountCents: 10001,
          actor: "support_agent",
          reason: "x",
          requestedAt: at,
        },
        ctx,
        P,
      ),
    ).toThrow(/approval/);
  });
  it("blocks refunds while a dispute is open", () => {
    expect(() =>
      planRefund(
        { kind: "full", amountCents: 1, actor: "admin", reason: "x", requestedAt: at },
        { ...ctx, disputeOpen: true },
        P,
      ),
    ).toThrow();
  });
  it("lost dispute only reverses the card portion and recovers the tasker share", () => {
    const d = disputeLost(
      10350,
      7350,
      0,
      { subtotal: 9000, total: 10350, taskerCommission: 1350 },
      1500,
    );
    expect(d.cardReversedCents).toBe(7350);
    expect(d.recoverFromTaskerCents).toBe(5432);
    expect(d.platformLossCents).toBe(7350 - 5432 + 1500);
  });
});

describe("tips, payouts, promo, ledger, state", () => {
  const done = new Date("2026-11-10T19:00:00Z");
  it("tips are card-only, capped at 25% and 100% to the tasker", () => {
    expect(validateTip(2250, "card", 9000, done, new Date("2026-11-11T00:00:00Z"), P)).toEqual({
      taskerGets: 2250,
      platformFee: 0,
    });
    expect(() =>
      validateTip(2251, "card", 9000, done, new Date("2026-11-11T00:00:00Z"), P),
    ).toThrow();
    expect(() =>
      validateTip(500, "points", 9000, done, new Date("2026-11-11T00:00:00Z"), P),
    ).toThrow();
  });
  it("pays out only after the hold and never while suspended or negative", () => {
    const items = [
      { bookingId: "b1", netCents: 7650, completedAt: done, cardSettled: true, paidOut: false },
    ];
    expect(planPayout(items, 0, "active", new Date("2026-11-12T00:00:00Z"), P).amountCents).toBe(0);
    expect(planPayout(items, 0, "active", new Date("2026-11-14T00:00:00Z"), P).amountCents).toBe(
      7650,
    );
    expect(
      planPayout(items, 0, "suspended", new Date("2026-11-14T00:00:00Z"), P).blockedReason,
    ).toMatch(/suspended/);
    expect(
      planPayout(items, -8000, "active", new Date("2026-11-14T00:00:00Z"), P).amountCents,
    ).toBe(0);
  });
  it("promo codes cap at the subtotal and can't be reused", () => {
    expect(
      promoDiscount(
        { code: "FIRST20", kind: "percent", value: 2000, firstTaskOnly: true },
        9000,
        true,
        false,
        done,
      ),
    ).toBe(1800);
    expect(() =>
      promoDiscount(
        { code: "FIRST20", kind: "percent", value: 2000, firstTaskOnly: true },
        9000,
        true,
        true,
        done,
      ),
    ).toThrow();
  });
  it("rejects unbalanced ledger transactions", () => {
    expect(() => txn("bad", [dr("card_clearing", 100), cr("client_funds_held", 99)])).toThrow();
    expect(txn("ok", [dr("card_clearing", 100), cr("client_funds_held", 100)]).lines).toHaveLength(
      2,
    );
  });
  it("enforces the booking state machine and re-auth window", () => {
    expect(canTransition("completed", "canceled_client")).toBe(false);
    expect(needsReauth(new Date("2026-11-01"), new Date("2026-11-20"), 7, 1)).toBe(true);
  });
});
