import {
  holdAtAfterReschedule,
  needsRehold,
  planPayment,
  POLICY_V2 as V2,
  DEFAULT_POLICY as V1,
} from "../../supabase/functions/_shared/domain/index.ts";

const H = 3_600_000;
const now = new Date("2026-11-01T12:00:00Z");
const at = (hours: number) => new Date(now.getTime() + hours * H);

describe("planPayment (v2)", () => {
  it("holds now when the start is within 96 hours, inclusive", () => {
    for (const h of [1, 24, 95.99, 96]) {
      const p = planPayment({ startAt: at(h), now, cardCents: 8350 }, V2);
      expect(p.mode).toBe("hold_now");
      expect(p.holdAt).toBeNull();
      expect(p.legacy).toBe(false);
    }
  });

  it("saves the card and holds 48 hours before the start when the start is further out", () => {
    const start = at(96.01);
    const p = planPayment({ startAt: start, now, cardCents: 8350 }, V2);
    expect(p.mode).toBe("save_card_hold_later");
    expect(p.holdAt!.getTime()).toBe(start.getTime() - 48 * H);
    expect(p.holdAt!.getTime()).toBeGreaterThan(now.getTime());
    expect(p.reason).toMatch(/48 hours/);
  });

  it("needs no card when points and credits cover everything", () => {
    const p = planPayment({ startAt: at(300), now, cardCents: 0 }, V2);
    expect(p).toMatchObject({ mode: "card_not_needed", cardCents: 0, holdAt: null });
  });

  it("v1 always holds now, as before", () => {
    const p = planPayment({ startAt: at(2000), now, cardCents: 8350 }, V1);
    expect(p).toMatchObject({ mode: "hold_now", legacy: true, holdAt: null });
    expect(planPayment({ startAt: at(5), now, cardCents: 0 }, V1).mode).toBe("card_not_needed");
  });
});

describe("hold lifetime", () => {
  const start = new Date("2026-11-20T17:00:00Z");

  it("re-holds when capture_before is earlier than start + estimate + 24 h", () => {
    const end24 = start.getTime() + 120 * 60_000 + 24 * H;
    expect(needsRehold(new Date(end24 - 1), start, 120, V2)).toBe(true);
    expect(needsRehold(new Date(end24), start, 120, V2)).toBe(false);
    expect(needsRehold(new Date(end24 + 1), start, 120, V2)).toBe(false);
  });

  it("a hold placed 48 h before the start lasts well past the task (4 d 18 h minimum, plan 7.1)", () => {
    const placed = new Date(start.getTime() - 48 * H);
    const captureBefore = new Date(placed.getTime() + (4 * 24 + 18) * H);
    expect(needsRehold(captureBefore, start, 24 * 60, V2)).toBe(false);
  });

  it("a reschedule moves hold_at to 48 h before the new start but never into the past", () => {
    expect(holdAtAfterReschedule(at(200), now, V2).getTime()).toBe(at(200).getTime() - 48 * H);
    expect(holdAtAfterReschedule(at(10), now, V2).getTime()).toBe(now.getTime());
  });
});
