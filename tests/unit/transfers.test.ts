import { planTransfers } from "../../supabase/functions/_shared/domain/index.ts";

const main = (already = 0) => ({
  chargeId: "ch_main",
  amountCents: 8350,
  alreadyTransferredCents: already,
});
const extras = (already = 0) => ({
  chargeId: "ch_extras",
  amountCents: 3838,
  alreadyTransferredCents: already,
});

describe("planTransfers (plan 7.3, worked example 7.4)", () => {
  it("splits the tasker share over the charges in order", () => {
    // 10812 = 8350 (main) + 2462 (extras)
    expect(planTransfers(10812, [main(), extras()])).toEqual([
      { sourceTransaction: "ch_main", amountCents: 8350 },
      { sourceTransaction: "ch_extras", amountCents: 2462 },
    ]);
  });

  it("pays the part no charge covers from the platform balance", () => {
    expect(planTransfers(7650, [])).toEqual([{ sourceTransaction: null, amountCents: 7650 }]);
    expect(planTransfers(9000, [main()])).toEqual([
      { sourceTransaction: "ch_main", amountCents: 8350 },
      { sourceTransaction: null, amountCents: 650 },
    ]);
  });

  it("uses only what is left on each charge", () => {
    expect(planTransfers(3000, [main(8000), extras()])).toEqual([
      { sourceTransaction: "ch_main", amountCents: 350 },
      { sourceTransaction: "ch_extras", amountCents: 2650 },
    ]);
    expect(planTransfers(100, [main(8350)])).toEqual([
      { sourceTransaction: null, amountCents: 100 },
    ]);
  });

  it("nets negative adjustments first, and sends nothing when the net is zero or less", () => {
    expect(planTransfers(10812, [main(), extras()], -1000)).toEqual([
      { sourceTransaction: "ch_main", amountCents: 8350 },
      { sourceTransaction: "ch_extras", amountCents: 1462 },
    ]);
    expect(planTransfers(5000, [main()], -5000)).toEqual([]);
    expect(planTransfers(5000, [main()], -6000)).toEqual([]);
    expect(planTransfers(0, [main()])).toEqual([]);
  });

  it("never exceeds a charge's room, always sums to the net share (property)", () => {
    let seed = 42;
    const rnd = (n: number) => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed % n;
    };
    for (let i = 0; i < 500; i++) {
      const charges = Array.from({ length: rnd(4) }, (_, k) => {
        const amount = rnd(20_000);
        return {
          chargeId: `ch_${k}`,
          amountCents: amount,
          alreadyTransferredCents: rnd(amount + 1),
        };
      });
      const share = rnd(30_000);
      const adj = -rnd(5_000);
      const plan = planTransfers(share, charges, adj);
      const net = Math.max(0, share + adj);
      expect(plan.reduce((a, t) => a + t.amountCents, 0)).toBe(net);
      for (const t of plan) {
        expect(t.amountCents).toBeGreaterThan(0);
        const c = charges.find((x) => x.chargeId === t.sourceTransaction);
        if (c) expect(t.amountCents).toBeLessThanOrEqual(c.amountCents - c.alreadyTransferredCents);
      }
      expect(plan.filter((t) => t.sourceTransaction === null).length).toBeLessThanOrEqual(1);
    }
  });

  it("rejects fractional cents and positive adjustments", () => {
    expect(() => planTransfers(10.5, [])).toThrow(/integer/);
    expect(() => planTransfers(100, [], 5)).toThrow(/zero or negative/);
  });
});
