// Money policy v2 (plan 7.1): the card minimum, the tip and extras minimums, and the seed row's fidelity.

import { readFileSync } from "node:fs";
import {
  allocateTenders,
  DEFAULT_POLICY as V1,
  extrasFigures,
  extrasProblem,
  POLICY_V2 as V2,
  quote,
  tipLimits,
  validateTip,
  type Available,
  type MoneyPolicy,
} from "../../supabase/functions/_shared/domain/index.ts";

const none: Available = { promoCents: 0, walletCents: 0, pointsBalance: 0, pointsRequested: 0 };
const TOTAL = 10350; // Tara, 2 hours: 9000 + 15% fee

describe("card minimum (v2): the card share is 0 or at least 50 cents", () => {
  // promo covers all but N cents of the card share
  const cardShare = (policy: MoneyPolicy, promo: number) =>
    allocateTenders(TOTAL, { ...none, promoCents: promo }, policy);

  it.each([
    [0, 0, 10350, false], // fully covered: no card
    [1, 50, 10300, true], // card would be 1 -> topped up to 50, promo reduced by 49
    [49, 50, 10300, true], // card would be 49 -> 50
    [50, 50, 10300, false], // exactly the minimum: untouched
    [51, 51, 10299, false],
  ])("card share %i cents becomes %i", (wanted, card, promo, applied) => {
    const a = cardShare(V2, TOTAL - wanted);
    expect(a.parts.card).toBe(card);
    expect(a.parts.promo).toBe(promo);
    expect(a.parts.card + a.parts.promo).toBe(TOTAL);
    expect(a.cardMinimumApplied === true).toBe(applied);
  });

  it("v1 is unchanged: the same inputs leave a 1 cent card share", () => {
    const a = cardShare(V1, TOTAL - 1);
    expect(a.parts).toEqual({ card: 1, points: 0, wallet: 0, promo: TOTAL - 1 });
    expect(a.cardMinimumApplied).toBeUndefined();
  });

  it("plan example: points 10320 of 10350 would leave 30 cents, so points drop to 10300", () => {
    const a = allocateTenders(
      TOTAL,
      { ...none, pointsBalance: 20_000, pointsRequested: 10_320 },
      V2,
    );
    expect(a.parts).toEqual({ card: 50, points: 10_300, wallet: 0, promo: 0 });
    expect(a.pointsUsed).toBe(10_300);
  });

  it("reduces the other tenders in reverse use order: wallet, then points, then promo", () => {
    // promo 5000 + points 2000 + wallet 3320 = 10320 -> card 30; shortfall 20 comes out of the wallet
    const a = allocateTenders(
      TOTAL,
      { promoCents: 5000, walletCents: 3320, pointsBalance: 2000, pointsRequested: 2000 },
      V2,
    );
    expect(a.parts).toEqual({ card: 50, points: 2000, wallet: 3300, promo: 5000 });
    // wallet only has 5: the rest of the shortfall comes from points, then promo
    const b = allocateTenders(
      TOTAL,
      { promoCents: 5000, walletCents: 5, pointsBalance: 5315, pointsRequested: 5315 },
      V2,
    );
    expect(b.parts.card).toBe(50);
    expect(b.parts.wallet).toBe(0);
    expect(b.parts.points).toBe(5315 - 15);
    expect(b.pointsUsed).toBe(5300);
    expect(b.parts.promo).toBe(5000);
    expect(b.parts.card + b.parts.points + b.parts.wallet + b.parts.promo).toBe(TOTAL);
  });

  it("takes whole points when a point is worth more than a cent", () => {
    const p: MoneyPolicy = {
      ...V2,
      points: { ...V2.points, centsPerPoint: 3, minRedeemPoints: 1 },
    };
    // 10350 total, 3450 points * 3 = 10350 would be card 0; request 3449 points -> 10347, card 3 -> shortfall 47
    const a = allocateTenders(TOTAL, { ...none, pointsBalance: 4000, pointsRequested: 3449 }, p);
    expect(a.parts.card).toBeGreaterThanOrEqual(50);
    expect(a.parts.points % 3).toBe(0);
    expect(a.parts.points).toBe(a.pointsUsed * 3);
    expect(a.parts.card + a.parts.points).toBe(TOTAL);
    expect(a.parts.card).toBe(51); // 16 points = 48 cents given back covers 47; the card pays 3 + 48
  });

  it("rejects a booking whose whole total is under the minimum and needs the card", () => {
    // total 40: 4 minutes at $6/h... use a total below 50 directly
    expect(() => allocateTenders(40, none, V2)).toThrow(/card minimum/);
    expect(() => allocateTenders(49, none, V2)).toThrow(/card minimum/);
    expect(allocateTenders(50, none, V2).parts.card).toBe(50);
    // but a small total fully covered by credit is fine: no card share at all
    expect(allocateTenders(40, { ...none, promoCents: 40 }, V2).parts.card).toBe(0);
    // v1 still accepts it
    expect(allocateTenders(40, none, V1).parts.card).toBe(40);
  });

  it("promo-only bookings are untouched", () => {
    expect(allocateTenders(TOTAL, { ...none, promoCents: 20_000 }, V2).parts).toEqual({
      card: 0,
      points: 0,
      wallet: 0,
      promo: TOTAL,
    });
  });
});

describe("tip minimum (v2)", () => {
  const done = new Date("2026-11-10T12:00:00Z");
  const now = new Date("2026-11-11T12:00:00Z");
  const tip = (cents: number, policy = V2) => validateTip(cents, "card", 9000, done, now, policy);

  it("rejects 1..49 cents, accepts 50 and the cap, rejects over the cap", () => {
    expect(() => tip(1)).toThrow(/at least 50/);
    expect(() => tip(49)).toThrow(/at least 50/);
    expect(tip(50).taskerGets).toBe(50);
    expect(tip(51).taskerGets).toBe(51);
    expect(tip(2250).taskerGets).toBe(2250); // cap = 25% of 9000
    expect(() => tip(2251)).toThrow(/cap/);
  });

  it("v1 allows a 1 cent tip", () => {
    expect(tip(1, V1).taskerGets).toBe(1);
  });

  it("tipLimits shows the room left under the cap for all tips together", () => {
    expect(tipLimits(9000, 0, V2)).toEqual({
      capCents: 2250,
      minCents: 50,
      alreadyTippedCents: 0,
      roomCents: 2250,
    });
    expect(tipLimits(9000, 2000, V2).roomCents).toBe(250);
    expect(tipLimits(9000, 2250, V2).roomCents).toBe(0);
    expect(tipLimits(9000, 3000, V2).roomCents).toBe(0);
    expect(tipLimits(9000, 0, V1).minCents).toBe(0);
  });
});

describe("extras (v2): the card charge is 0 or at least 50 cents", () => {
  it("worked example: 30 extra minutes at $45 + $12.50 expenses", () => {
    const f = extrasFigures(4500, 30, 1250, V2);
    expect(f).toMatchObject({
      extraLaborCents: 2250,
      extraFeeCents: 338,
      extraTaxCents: 0,
      expensesCents: 1250,
      totalCents: 3838,
      commissionCents: 338,
      taskerPayCents: 2250 - 338 + 1250,
      platformCents: 338 + 338,
    });
    expect(f.problem).toBeUndefined();
    // tasker 7650 (main) + 3162 (extras) = 10812; platform 1350 + 1350 + 676 = 3376 (plan 7.4)
    expect(7650 + f.taskerPayCents).toBe(10812);
  });

  it("zero extras is fine", () => {
    const f = extrasFigures(4500, 0, 0, V2);
    expect(f.totalCents).toBe(0);
    expect(f.problem).toBeUndefined();
  });

  it.each([
    [1, true],
    [30, true],
    [49, true],
    [50, false],
    [51, false],
  ])("expenses of %i cents -> problem: %s", (expenses, problem) => {
    expect(extrasFigures(4500, 0, expenses, V2).problem !== undefined).toBe(problem);
  });

  it("a minute of a low rate is below the minimum too (labor 2 + fee 0)", () => {
    expect(extrasFigures(100, 1, 0, V2).problem).toMatch(/below the 50-cent card minimum/);
  });

  it("v1 has no extras minimum", () => {
    expect(extrasFigures(4500, 0, 1, V1).problem).toBeUndefined();
    expect(extrasProblem(1, V1)).toBeUndefined();
  });

  it("matches quote(): the same labor and fee as a booking of that length", () => {
    const q = quote(4500, 45, V2);
    const f = extrasFigures(4500, 45, 0, V2);
    expect(f.extraLaborCents).toBe(q.subtotal);
    expect(f.extraFeeCents).toBe(q.serviceFee);
  });

  it("rejects negative or fractional inputs", () => {
    expect(() => extrasFigures(4500, 0, -1, V2)).toThrow();
    expect(() => extrasFigures(4500, 1.5, 0, V2)).toThrow();
    expect(() => extrasFigures(4500, 0, 0.5, V2)).toThrow();
  });
});

describe("policy v2 only adds rules", () => {
  it("everything else equals v1, so quotes and the cancellation curve do not move", () => {
    const { version: _v1, card: _c1, extras: _e1, consent: _k1, ...r1 } = V1 as MoneyPolicy;
    const { version: _v2, card: _c2, extras: _e2, consent: _k2, ...r2 } = V2;
    expect(r2.clientServiceFeeBps).toBe(r1.clientServiceFeeBps);
    expect(r2.cancellation).toEqual(r1.cancellation);
    expect(r2.tips).toEqual({ ...r1.tips, minCents: 50 });
    expect(r2.auth).toMatchObject({ ...r1.auth });
    expect(quote(4500, 120, V2)).toEqual(quote(4500, 120, V1));
  });

  it("the seeded migration row is exactly POLICY_V2", () => {
    const sql = readFileSync(
      new URL("../../supabase/migrations/20261101000100_policy_v2.sql", import.meta.url),
      "utf8",
    );
    const m = sql.match(/values \(2, '(\{.*\})'::jsonb, now\(\)\)/);
    expect(m).not.toBeNull();
    expect(JSON.parse(m![1])).toEqual(V2);
  });
});
