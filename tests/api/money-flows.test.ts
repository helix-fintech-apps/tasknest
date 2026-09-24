// End-to-end money flows against the `api` Edge Function (fake payments provider).
// Run: SUPABASE_URL=... SUPABASE_ANON_KEY=... npx vitest run tests/api
// Tests in this file run in order (the payout/dispute test relies on earlier earnings).

import {
  applyBps,
  clientCancellation,
  DEFAULT_POLICY,
  type MoneyPolicy,
} from "../../supabase/functions/_shared/domain/index.ts";
import {
  api,
  apiRaw,
  availablePoints,
  book,
  completeFlow,
  daysAfter,
  ensurePoints,
  ensureTaskerActive,
  expectOk,
  freeSlot,
  hoursBefore,
  kinds,
  ledgerLinesFor,
  LIVE,
  net,
  rest,
  SERVICE_ROLE_KEY,
  SKIP_MESSAGE,
  slotBetween,
  SUPABASE_URL,
  taskerBalance,
  token,
  USERS,
  type ApiResult,
  type Json,
} from "./helpers.ts";

if (!LIVE) console.warn(SKIP_MESSAGE);

const T = 120_000; // per-test timeout (each API call is a network round trip)
const SECOND = 1000;

/** Retry requests that lost a lease race (409 busy) with the same Idempotency-Key. */
async function settle(requests: (() => Promise<ApiResult>)[]): Promise<ApiResult[]> {
  const first = await Promise.all(requests.map((r) => r()));
  const out: ApiResult[] = [];
  for (let i = 0; i < first.length; i++) {
    let r = first[i];
    for (let n = 0; n < 5 && r.status === 409 && r.body?.error?.code === "busy"; n++)
      r = await requests[i]();
    out.push(r);
  }
  return out;
}

describe.skipIf(!LIVE)("TaskNest API money flows (fake provider)", () => {
  beforeAll(async () => {
    const health = await apiRaw("GET", "/health", await token("ava"));
    if (health.body?.provider !== "fake") {
      throw new Error(
        `tests/api need PAYMENTS_PROVIDER=fake, the API reports ${JSON.stringify(health.body)}`,
      );
    }
    await ensureTaskerActive("tara");
    await ensureTaskerActive("leo");
    await ensurePoints("ava", 3000);
    await ensurePoints("ben", 600);
  }, T);

  it(
    "rejects missing sessions, wrong roles, bad input and an unauthorized test clock",
    async () => {
      const anon = await fetch(`${SUPABASE_URL}/functions/v1/api/quote`, {
        method: "POST",
        body: "{}",
      });
      expect(anon.status).toBe(401);
      expect((await book("tara", { tasker: "leo" })).status).toBe(403);
      const pending = await book("ava", { tasker: "pia" });
      expect(pending.status).toBe(409);
      expect(pending.body.error.code).toBe("tasker_unavailable");
      const badDate = await api("ava", "POST", "/bookings", {
        taskerId: USERS.tara.id,
        localStart: "2027-02-30T10:00",
        tz: "UTC",
        minutes: 60,
        description: "x",
      });
      expect(badDate.status).toBe(400);
      expect(badDate.body.error).toMatchObject({ code: "bad_request" });
      // A client cannot claim a different time without an admin-minted test clock token.
      const clock = await api(
        "ava",
        "POST",
        "/quote",
        { taskerId: USERS.tara.id, minutes: 60 },
        { now: new Date(), rawClock: true },
      );
      expect(clock.status).toBe(403);
      expect(clock.body.error.code).toBe("test_clock_forbidden");
      expect((await api("ava", "POST", "/admin/test-clock", { userId: USERS.ava.id })).status).toBe(
        403,
      );
    },
    T,
  );

  it(
    "quotes with promo + points using the domain allocation",
    async () => {
      const r = await api("ava", "POST", "/quote", {
        taskerId: USERS.tara.id,
        minutes: 120,
        pointsRequested: 1000,
        promoCode: "WELCOME10",
      });
      expectOk(r);
      expect(r.body.quote).toMatchObject({
        subtotal: 9000,
        serviceFee: 1350,
        total: 10350,
        taskerNet: 7650,
      });
      expect(r.body.allocation).toEqual({
        parts: { promo: 1000, points: 1000, wallet: 0, card: 8350 },
        pointsUsed: 1000,
      });
      expect(r.body.discountCents).toBe(1000);
      expect(typeof r.body.policyVersion).toBe("number");
      const tooFew = await api("ava", "POST", "/quote", {
        taskerId: USERS.tara.id,
        minutes: 120,
        pointsRequested: 100,
      });
      expect(tooFew.status).toBe(422);
      expect(tooFew.body.error.message).toMatch(/minimum redemption/);
    },
    T,
  );

  let completedWithExtras = "";
  it(
    "points + card booking: holds the points in the ledger, completes with extras, redeems and earns points",
    async () => {
      const before = await availablePoints("ava");
      const b = await book("ava", { pointsRequested: 1000 });
      expectOk(b, 201);
      const id = b.body.booking.id;
      expect(b.body.booking).toMatchObject({
        status: "requested",
        total_cents: 10350,
        points_reserved: 1000,
      });
      expect(b.body.tenders.find((t: Json) => t.tender === "card").amount_cents).toBe(9350);
      expect(b.body.tenders.find((t: Json) => t.tender === "points")).toMatchObject({
        amount_cents: 1000,
        points: 1000,
      });
      expect(b.body.booking.stripe_payment_intent_id).toMatch(/^pi_fake_/);
      expect(await availablePoints("ava")).toBe(before - 1000);
      const reserve = await rest("ava", "points_movements", `booking_id=eq.${id}&kind=eq.reserve`);
      expect(reserve.reduce((a: number, m: Json) => a + m.points, 0)).toBe(-1000);
      // Booking creation posts the hold: points leave the client's balance and sit in client funds.
      const held = await ledgerLinesFor(id);
      expect(kinds(held)).toEqual(["booking_hold"]);
      expect(net(held, "client_funds_held", USERS.ava.id)).toBe(1000);
      expect(net(held, "points_outstanding", USERS.ava.id, "POINTS")).toBe(-1000);
      expect(net(held, "card_clearing")).toBe(0); // an authorization moves no money

      expectOk(await api("tara", "POST", `/bookings/${id}/accept`, {}));
      expectOk(await api("tara", "POST", `/bookings/${id}/start`, {}));
      const done = await api("tara", "POST", `/bookings/${id}/complete`, {
        extraMinutes: 30,
        expensesCents: 1250,
      });
      expectOk(done);
      completedWithExtras = id;
      // extras: 30 min at $45 = 2250 + 15% fee (338) + expenses 1250 = 3838, charged separately
      expect(done.body.booking).toMatchObject({
        status: "completed",
        captured_cents: 9350,
        extra_cents: 3838,
        extra_labor_cents: 2250,
        extra_service_fee_cents: 338,
        expenses_cents: 1250,
      });
      expect(done.body.booking.extra_payment_intent_id).toMatch(/^pi_fake_/);
      // points: 1 per $ of card cash (9350 + 3838 = 13188) -> 131, pending 7 days
      expect(done.body.pointsEarned).toBe(131);
      const lots = await rest("ava", "points_lots", `booking_id=eq.${id}&kind=eq.earn`);
      expect(lots).toHaveLength(1);
      expect(new Date(lots[0].available_at).getTime()).toBeGreaterThan(
        Date.now() + 6.9 * 86_400_000,
      );
      const redeem = await rest("ava", "points_movements", `booking_id=eq.${id}&kind=eq.redeem`);
      expect(redeem.reduce((a: number, m: Json) => a + m.points, 0)).toBe(-1000);

      const lines = await ledgerLinesFor(id);
      expect(kinds(lines)).toEqual([
        "booking_completed",
        "booking_hold",
        "extras_charged",
        "points_earned",
      ]);
      // tasker: 9000 - 15% (1350) + extras labor 2250 - 338 + expenses 1250 = 10812
      expect(net(lines, "tasker_payable", USERS.tara.id)).toBe(10812);
      expect(net(lines, "platform_revenue")).toBe(1350 + 1350 + 338 + 338);
      expect(-net(lines, "card_clearing")).toBe(9350 + 3838);
      expect(net(lines, "client_funds_held", USERS.ava.id)).toBe(0); // everything held was recognized
      expect(net(lines, "points_issued", undefined, "POINTS")).toBe(1000 - 131); // redeemed back in, earned issued out
    },
    T,
  );

  it(
    "cancellation curve at the exact tier boundaries (48h inclusive, just under, 24h inclusive, just under)",
    async () => {
      // Exactly 48h before: 100% back. Card-only, so no money ever moved: no ledger lines at all.
      const full = await book("ava");
      expectOk(full, 201);
      const r1 = await api(
        "ava",
        "POST",
        `/bookings/${full.body.booking.id}/cancel`,
        { reason: "plans changed" },
        { now: hoursBefore(full.slot.startAt, 48) },
      );
      expectOk(r1);
      expect(r1.body.booking).toMatchObject({ status: "canceled_client", captured_cents: 0 });
      expect(r1.body.refund).toMatchObject({ refundCents: 10350, retainedCents: 0 });
      expect(await ledgerLinesFor(full.body.booking.id)).toHaveLength(0);

      // One second under 48h: 50%. The tasker gets half the labor less commission; the fee share stays with us.
      const half = await book("ava");
      expectOk(half, 201);
      expectOk(await api("tara", "POST", `/bookings/${half.body.booking.id}/accept`, {}));
      const justUnder = new Date(hoursBefore(half.slot.startAt, 48).getTime() + SECOND);
      const r2 = await api(
        "ava",
        "POST",
        `/bookings/${half.body.booking.id}/cancel`,
        { reason: "plans changed" },
        { now: justUnder },
      );
      expectOk(r2);
      expect(r2.body.refund).toMatchObject({ refundCents: 5175, retainedCents: 5175 });
      expect(r2.body.outcome).toMatchObject({ taskerPayCents: 3825, platformCents: 1350 });
      expect(r2.body.booking.captured_cents).toBe(5175);
      const l2 = await ledgerLinesFor(half.body.booking.id);
      expect(kinds(l2)).toEqual(["cancellation_fee"]);
      expect(net(l2, "tasker_payable", USERS.tara.id)).toBe(3825);
      expect(net(l2, "platform_revenue")).toBe(1350);
      expect(-net(l2, "card_clearing")).toBe(5175);

      // Exactly 24h before, paid with points + card: still the 50% tier; the fee comes from the card first
      // and the points are released back to the client.
      const pointsBefore = await availablePoints("ava");
      const at24 = await book("ava", { pointsRequested: 1000 });
      expectOk(at24, 201);
      const r3 = await api(
        "ava",
        "POST",
        `/bookings/${at24.body.booking.id}/cancel`,
        { reason: "late" },
        { now: hoursBefore(at24.slot.startAt, 24) },
      );
      expectOk(r3);
      expect(r3.body.refund.kept).toEqual({ card: 5175, points: 0, wallet: 0, promo: 0 });
      expect(r3.body.refund.perTender).toEqual({ card: 4175, points: 1000, wallet: 0, promo: 0 });
      expect(await availablePoints("ava")).toBe(pointsBefore);
      const l3 = await ledgerLinesFor(at24.body.booking.id);
      expect(kinds(l3)).toEqual(["booking_hold", "booking_release", "cancellation_fee"]);
      expect(net(l3, "client_funds_held", USERS.ava.id)).toBe(0);
      expect(net(l3, "points_outstanding", USERS.ava.id, "POINTS")).toBe(0);
      const tenders = await rest("ava", "booking_tenders", `booking_id=eq.${at24.body.booking.id}`);
      expect(tenders.find((t: Json) => t.tender === "points").refunded_cents).toBe(1000);

      // One second under 24h: 60 minutes of the tasker's rate.
      const late = await book("ava");
      expectOk(late, 201);
      const r4 = await api(
        "ava",
        "POST",
        `/bookings/${late.body.booking.id}/cancel`,
        { reason: "late" },
        {
          now: new Date(hoursBefore(late.slot.startAt, 24).getTime() + SECOND),
        },
      );
      expectOk(r4);
      expect(r4.body.refund).toMatchObject({ retainedCents: 4500, refundCents: 5850 });
      expect(r4.body.outcome).toMatchObject({ taskerPayCents: 3825, platformCents: 675 });

      // Preview after the start time: the last tier applies.
      const b = await book("ava");
      expectOk(b, 201);
      const p = await api(
        "ava",
        "GET",
        `/bookings/${b.body.booking.id}/cancel-preview`,
        undefined,
        { now: new Date(b.slot.startAt.getTime() + 3_600_000) },
      );
      expectOk(p);
      expect(p.body.refund).toMatchObject({ retainedCents: 4500, refundCents: 5850 });
      expectOk(
        await api(
          "ava",
          "POST",
          `/bookings/${b.body.booking.id}/cancel`,
          { reason: "cleanup" },
          { now: hoursBefore(b.slot.startAt, 72) },
        ),
      );
    },
    T,
  );

  it(
    "reschedule keeps the original start as the cancellation anchor",
    async () => {
      const b = await book("ava");
      expectOk(b, 201);
      const id = b.body.booking.id;
      const later = new Date(b.slot.startAt.getTime() + 24 * 3_600_000);
      const r = await api("ava", "POST", `/bookings/${id}/reschedule`, {
        localStart: later.toISOString().slice(0, 16),
      });
      expectOk(r);
      expect(new Date(r.body.booking.start_at).getTime()).toBe(later.getTime());
      expect(new Date(r.body.booking.original_start_at).getTime()).toBe(b.slot.startAt.getTime());
      // 60h before the NEW start is only 36h before the ORIGINAL start -> 50% tier, not 100%.
      const p = await api("ava", "GET", `/bookings/${id}/cancel-preview`, undefined, {
        now: hoursBefore(later, 60),
      });
      expect(p.body.refund.retainedCents).toBe(5175);
      expectOk(
        await api(
          "ava",
          "POST",
          `/bookings/${id}/cancel`,
          { reason: "cleanup" },
          { now: hoursBefore(b.slot.startAt, 72) },
        ),
      );
    },
    T,
  );

  it(
    "tasker decline releases the authorization and the reserved points (hold reversed in the ledger)",
    async () => {
      const before = await availablePoints("ava");
      const b = await book("ava", { pointsRequested: 500 });
      expectOk(b, 201);
      const r = await api("tara", "POST", `/bookings/${b.body.booking.id}/decline`, {
        reason: "busy",
      });
      expectOk(r);
      expect(r.body.booking.status).toBe("declined");
      expect(r.body.strike).toBeNull();
      expect(await availablePoints("ava")).toBe(before);
      const lines = await ledgerLinesFor(b.body.booking.id);
      expect(kinds(lines)).toEqual(["booking_hold", "booking_release"]);
      expect(net(lines, "client_funds_held", USERS.ava.id)).toBe(0);
    },
    T,
  );

  it(
    "tasker cancel: full refund, strike + $10 fee, suspension at 3 strikes in 30 days",
    async () => {
      let suspended = false;
      for (let i = 0; i < 3 && !suspended; i++) {
        const b = await book("ben", { tasker: "leo", minutes: 60 });
        expectOk(b, 201);
        const id = b.body.booking.id;
        expectOk(await api("leo", "POST", `/bookings/${id}/accept`, {}));
        const r = await api("leo", "POST", `/bookings/${id}/cancel`, { reason: "sick" });
        expectOk(r);
        expect(r.body.booking.status).toBe("canceled_tasker");
        expect(r.body.refund.refundCents).toBe(4370); // 3800 + 570 fee: 100% back
        expect(r.body.strike.feeCents).toBe(1000);
        expect(r.body.strike.suspended).toBe(r.body.strike.strikesInWindow >= 3);
        const lines = await ledgerLinesFor(id);
        expect(net(lines, "tasker_payable", USERS.leo.id)).toBe(-1000);
        suspended = r.body.strike.suspended;
      }
      expect(suspended).toBe(true);
      const t = await rest("admin", "taskers", `id=eq.${USERS.leo.id}&select=status`);
      expect(t[0].status).toBe("suspended");
      const blocked = await book("ben", { tasker: "leo" });
      expect(blocked.status).toBe(409);
      expect(blocked.body.error.code).toBe("tasker_unavailable");
      await ensureTaskerActive("leo");
    },
    T,
  );

  it(
    "tips: card only, capped at 25% of the subtotal across all tips, within 30 days, 100% to the tasker",
    async () => {
      const id = completedWithExtras;
      expect((await api("ava", "POST", `/bookings/${id}/tip`, { amountCents: 2251 })).status).toBe(
        422,
      );
      expect(
        (await api("ava", "POST", `/bookings/${id}/tip`, { amountCents: 500, tender: "points" }))
          .status,
      ).toBe(422);
      expect(
        (
          await api(
            "ava",
            "POST",
            `/bookings/${id}/tip`,
            { amountCents: 500 },
            { now: daysAfter(new Date(), 31) },
          )
        ).status,
      ).toBe(422);
      const notDone = await book("ava");
      expect(
        (await api("ava", "POST", `/bookings/${notDone.body.booking.id}/tip`, { amountCents: 500 }))
          .status,
      ).toBe(422);
      await api(
        "ava",
        "POST",
        `/bookings/${notDone.body.booking.id}/cancel`,
        { reason: "cleanup" },
        { now: hoursBefore(notDone.slot.startAt, 72) },
      );
      const first = await api("ava", "POST", `/bookings/${id}/tip`, { amountCents: 2000 });
      expectOk(first);
      expect(first.body.tip).toMatchObject({ amountCents: 2000, taskerGets: 2000, platformFee: 0 });
      const over = await api("ava", "POST", `/bookings/${id}/tip`, { amountCents: 300 }); // 2300 > 2250 cap
      expect(over.status).toBe(422);
      expect(over.body.error.message).toMatch(/cap/);
      const last = await api("ava", "POST", `/bookings/${id}/tip`, { amountCents: 250 });
      expectOk(last);
      expect(last.body.tip.tippedTotalCents).toBe(2250);
      const tipLines = (await ledgerLinesFor(id)).filter((l) => l.ledger_txns.kind === "tip");
      expect(net(tipLines, "tasker_payable", USERS.tara.id)).toBe(2250);
      expect(-net(tipLines, "card_clearing")).toBe(2250);
    },
    T,
  );

  it(
    "partial refunds go card first, then points (returned), are capped per tender, and claw back earned points",
    async () => {
      const { id } = await completeFlow("ava", { pointsRequested: 1000 }); // card 9350 + points 1000, earns 93
      const req = await api("ava", "POST", `/bookings/${id}/refund`, {
        kind: "partial",
        amountCents: 3000,
        reason: "scratched table",
      });
      expect(req.status).toBe(202);
      expect(req.body.requested).toBe(true);

      const r1 = await api("agent", "POST", `/bookings/${id}/refund`, {
        kind: "partial",
        amountCents: 3000,
        reason: "scratched table",
      });
      expectOk(r1);
      expect(r1.body.refund.perTender).toEqual({ card: 3000, points: 0, wallet: 0, promo: 0 });
      // Tasker share = (subtotal - 15% commission) / total, proportional: floor(3000 * 7650 / 10350)
      expect(r1.body.refund.taskerClawbackCents).toBe(Math.floor((3000 * 7650) / 10350));
      expect(r1.body.refund.pointsClawedBack).toBe(Math.ceil((93 * 3000) / 9350));

      // The preview is exactly what the refund then does.
      const preview = await api("agent", "POST", `/bookings/${id}/refund-preview`, {
        kind: "partial",
        amountCents: 7000,
        reason: "redo",
      });
      expectOk(preview);
      const pointsBefore = await availablePoints("ava");
      const r2 = await api("agent", "POST", `/bookings/${id}/refund`, {
        kind: "partial",
        amountCents: 7000,
        reason: "redo",
      });
      expectOk(r2);
      expect(r2.body.refund.perTender).toEqual({ card: 6350, points: 650, wallet: 0, promo: 0 });
      expect(preview.body.plan.perTender).toEqual(r2.body.refund.perTender);
      expect(preview.body.plan.taskerClawbackCents).toBe(r2.body.refund.taskerClawbackCents);
      expect(preview.body.pointsClawedBack).toBe(r2.body.refund.pointsClawedBack);
      expect(r2.body.refund.pointsReturned).toBe(650);
      expect(r2.body.refund.pointsClawedBack).toBe(93 - Math.ceil((93 * 3000) / 9350)); // cumulative = all earned
      expect(await availablePoints("ava")).toBe(pointsBefore + 650);

      const over = await api("agent", "POST", `/bookings/${id}/refund`, {
        kind: "partial",
        amountCents: 1000,
        reason: "too much",
      });
      expect(over.status).toBe(422);
      expect(over.body.error.message).toMatch(/exceeds refundable/);

      const g = await api("agent", "POST", `/bookings/${id}/refund`, {
        kind: "goodwill",
        amountCents: 350,
        reason: "sorry",
      });
      expectOk(g);
      expect(g.body.refund).toMatchObject({
        perTender: { card: 0, points: 350, wallet: 0, promo: 0 },
        taskerClawbackCents: 0,
      });
      const tenders = await rest("admin", "booking_tenders", `booking_id=eq.${id}`);
      for (const t of tenders) expect(Number(t.refunded_cents)).toBe(Number(t.amount_cents));
      const again = await api("admin", "POST", `/bookings/${id}/refund`, {
        kind: "full",
        amountCents: 0,
        reason: "again",
      });
      expect(again.status).toBe(422);
      expect(again.body.error.message).toMatch(/nothing left to refund/);
    },
    T,
  );

  it(
    "support agents need an admin approver above the $100 limit; goodwill never touches the tasker",
    async () => {
      const { id } = await completeFlow("ava");
      const no = await api("agent", "POST", `/bookings/${id}/refund`, {
        kind: "goodwill",
        amountCents: 10350,
        reason: "big goodwill",
      });
      expect(no.status).toBe(422);
      expect(no.body.error.message).toMatch(/approval/);
      const self = await api("agent", "POST", `/bookings/${id}/refund`, {
        kind: "goodwill",
        amountCents: 10350,
        reason: "x",
        approvedBy: USERS.agent.id,
      });
      expect(self.status).toBe(422);
      const yes = await api("agent", "POST", `/bookings/${id}/refund`, {
        kind: "goodwill",
        amountCents: 10350,
        reason: "big goodwill",
        approvedBy: USERS.admin.id,
      });
      expectOk(yes);
      expect(yes.body.refund).toMatchObject({
        taskerClawbackCents: 0,
        requiresApproval: true,
        approvedBy: USERS.admin.id,
      });
      const lines = await ledgerLinesFor(id);
      expect(net(lines, "refund_expense")).toBe(-10350);
      expect(net(lines, "tasker_payable", USERS.tara.id)).toBe(7650);
      const refunds = await rest(
        "admin",
        "refunds",
        `booking_id=eq.${id}&select=approved_by,actor_role`,
      );
      expect(refunds).toEqual([{ approved_by: USERS.admin.id, actor_role: "support_agent" }]);
    },
    T,
  );

  it(
    "concurrent refunds on one booking are serialized and can never over-refund",
    async () => {
      const { id } = await completeFlow("ava"); // card 10350
      const keys = [1, 2, 3].map(() => crypto.randomUUID());
      const results = await settle(
        keys.map(
          (key, i) => () =>
            api(
              "admin",
              "POST",
              `/bookings/${id}/refund`,
              { kind: "partial", amountCents: 4000, reason: `concurrent ${i}` },
              { idem: key },
            ),
        ),
      );
      expect(results.map((r) => r.status).sort()).toEqual([200, 200, 422]);
      const tenders = await rest("admin", "booking_tenders", `booking_id=eq.${id}`);
      expect(tenders.reduce((a: number, t: Json) => a + Number(t.refunded_cents), 0)).toBe(8000);
      expect(await rest("admin", "refunds", `booking_id=eq.${id}`)).toHaveLength(2);
    },
    T,
  );

  it(
    "clawback beyond the user's points goes negative and blocks redemptions",
    async () => {
      const { id: earnedOn, completed } = await completeFlow("ben"); // card only, earns 103 pending points
      expect(completed.pointsEarned).toBe(103);
      const later = daysAfter(new Date(), 8); // test clock: the earned lot is available by then
      const quoteAt = async (pointsRequested?: number) =>
        api(
          "ben",
          "POST",
          "/quote",
          { taskerId: USERS.tara.id, minutes: 60, pointsRequested },
          { now: later },
        );
      let avail: number = (await quoteAt()).body.points.available;
      if (avail < 500) {
        expectOk(
          await api("admin", "POST", "/admin/points/grant", {
            userId: USERS.ben.id,
            points: 600 - avail,
            reason: "api test",
          }),
        );
        avail = (await quoteAt()).body.points.available;
      }
      // Spend the whole net balance (FIFO; the earned lot expires last so it is taken last).
      const s = freeSlot(30);
      const spend = await api(
        "ben",
        "POST",
        "/bookings",
        {
          taskerId: USERS.tara.id,
          localStart: s.localStart,
          tz: s.tz,
          minutes: 1440,
          description: "spend all points",
          pointsRequested: avail,
        },
        { now: later },
      );
      expectOk(spend, 201);
      try {
        expect((await quoteAt()).body.points.available).toBe(0);

        const refund = await api(
          "admin",
          "POST",
          `/bookings/${earnedOn}/refund`,
          { kind: "full", reason: "service not delivered" },
          { now: later },
        );
        expectOk(refund);
        expect(refund.body.refund.pointsClawedBack).toBe(103);
        // The clawback exceeds what is left: the balance goes negative...
        expect((await quoteAt()).body.points.available).toBe(-103);
        // ...and redemptions are blocked until it is repaid.
        const blocked = await quoteAt(500);
        expect(blocked.status).toBe(422);
        expect(blocked.body.error.message).toMatch(/not enough available points/);
        // The 103 points came out of the booking's own earn lot first (whatever was left in it) and the
        // rest became a negative "debt" lot. On a fresh database the spend above took the earn lot too, so
        // everything is debt; with debt from an earlier run the earn lot was untouched and covers it all.
        // Count the clawback movements themselves, so the check holds either way.
        const lotsOf = (kind: string) =>
          rest(
            "admin",
            "points_lots",
            `user_id=eq.${USERS.ben.id}&kind=eq.${kind}&booking_id=eq.${earnedOn}`,
          );
        const [earnLot] = await lotsOf("earn");
        const debtLots = await lotsOf("debt");
        const claws = await rest(
          "admin",
          "points_movements",
          `user_id=eq.${USERS.ben.id}&booking_id=eq.${earnedOn}&kind=eq.clawback`,
        );
        const fromLot = claws
          .filter((m: Json) => m.lot_id === earnLot.id)
          .reduce((a: number, m: Json) => a - Number(m.points), 0);
        const debt = debtLots.reduce((a: number, l: Json) => a - Number(l.points_remaining), 0);
        expect(fromLot + debt).toBe(103);
        expect(claws.reduce((a: number, m: Json) => a - Number(m.points), 0)).toBe(103);
        expect(refund.body.refund.pointsDebt).toBe(debt);
      } finally {
        // cleanup: cancel the big booking (>48h before start: reserved points released)
        expectOk(
          await api(
            "ben",
            "POST",
            `/bookings/${spend.body.booking.id}/cancel`,
            { reason: "cleanup" },
            { now: later },
          ),
        );
      }
    },
    T,
  );

  it(
    "idempotent retry returns the first result; reusing a key for a different request is rejected",
    async () => {
      const slot = freeSlot();
      const key = `test-${crypto.randomUUID()}`;
      const body = {
        taskerId: USERS.tara.id,
        localStart: slot.localStart,
        tz: slot.tz,
        minutes: 60,
        description: "idem",
      };
      const a = await api("ava", "POST", "/bookings", body, { idem: key });
      expectOk(a, 201);
      const b = await api("ava", "POST", "/bookings", body, { idem: key });
      expectOk(b, 201);
      expect(b.headers.get("idempotent-replayed")).toBe("true");
      expect(b.body.booking.id).toBe(a.body.booking.id);
      const rows = await rest(
        "ava",
        "bookings",
        `start_at=eq.${encodeURIComponent(slot.startAt.toISOString())}&tasker_id=eq.${USERS.tara.id}`,
      );
      expect(rows).toHaveLength(1);
      const c = await api("ava", "POST", "/bookings", { ...body, minutes: 90 }, { idem: key });
      expect(c.status).toBe(422);
      expect(c.body.error.code).toBe("idempotency_key_reused");
      const cancelKey = `test-${crypto.randomUUID()}`;
      const now = hoursBefore(slot.startAt, 72);
      const x1 = await api(
        "ava",
        "POST",
        `/bookings/${a.body.booking.id}/cancel`,
        { reason: "x" },
        { idem: cancelKey, now },
      );
      const x2 = await api(
        "ava",
        "POST",
        `/bookings/${a.body.booking.id}/cancel`,
        { reason: "x" },
        { idem: cancelKey, now },
      );
      expectOk(x1);
      expectOk(x2);
      expect(x2.body).toEqual(x1.body);
      expect(await rest("ava", "refunds", `booking_id=eq.${a.body.booking.id}`)).toHaveLength(1);

      // Two identical requests racing with the same key: one booking, never two.
      const raceSlot = freeSlot();
      const raceKey = `race-${crypto.randomUUID()}`;
      const raceBody = {
        taskerId: USERS.tara.id,
        localStart: raceSlot.localStart,
        tz: raceSlot.tz,
        minutes: 60,
        description: "race",
      };
      const race = await Promise.all(
        [1, 2].map(() => api("ava", "POST", "/bookings", raceBody, { idem: raceKey })),
      );
      for (const r of race) expect([201, 409]).toContain(r.status);
      expect(race.some((r) => r.status === 201)).toBe(true);
      const raced = await rest(
        "ava",
        "bookings",
        `start_at=eq.${encodeURIComponent(raceSlot.startAt.toISOString())}&tasker_id=eq.${USERS.tara.id}`,
      );
      expect(raced).toHaveLength(1);
      await api(
        "ava",
        "POST",
        `/bookings/${raced[0].id}/cancel`,
        { reason: "cleanup" },
        { now: hoursBefore(raceSlot.startAt, 72) },
      );
    },
    T,
  );

  it(
    "double-booking the same or an overlapping tasker slot is rejected, also when requests race",
    async () => {
      const slot = freeSlot();
      const a = await book("ava", { slot, minutes: 120 });
      expectOk(a, 201);
      const same = await book("ben", { slot, minutes: 60 });
      expect(same.status).toBe(409);
      expect(same.body.error.code).toBe("slot_taken");
      const overlapStart = new Date(slot.startAt.getTime() + 60 * 60_000);
      const overlap = await book("ben", {
        slot: {
          startAt: overlapStart,
          localStart: overlapStart.toISOString().slice(0, 16),
          tz: "UTC",
        },
        minutes: 60,
      });
      expect(overlap.status).toBe(409);
      const nextStart = new Date(slot.startAt.getTime() + 120 * 60_000);
      const adjacent = await book("ben", {
        slot: { startAt: nextStart, localStart: nextStart.toISOString().slice(0, 16), tz: "UTC" },
        minutes: 60,
      });
      expectOk(adjacent, 201);
      const now = hoursBefore(slot.startAt, 72);
      await api(
        "ava",
        "POST",
        `/bookings/${a.body.booking.id}/cancel`,
        { reason: "cleanup" },
        { now },
      );
      await api(
        "ben",
        "POST",
        `/bookings/${adjacent.body.booking.id}/cancel`,
        { reason: "cleanup" },
        { now },
      );

      const raceSlot = freeSlot();
      const race = await Promise.all([
        book("ava", { slot: raceSlot, minutes: 60 }),
        book("ben", { slot: raceSlot, minutes: 60 }),
      ]);
      expect(race.map((r) => r.status).sort()).toEqual([201, 409]);
      const winner = race.find((r) => r.status === 201)!;
      const who = winner.body.booking.client_id === USERS.ava.id ? "ava" : "ben";
      await api(
        who,
        "POST",
        `/bookings/${winner.body.booking.id}/cancel`,
        { reason: "cleanup" },
        { now: hoursBefore(raceSlot.startAt, 72) },
      );
    },
    T,
  );

  it(
    "review bonus is granted once",
    async () => {
      const { id } = await completeFlow("ava", { minutes: 60 });
      const r1 = await api("ava", "POST", `/bookings/${id}/review`, { rating: 5, body: "great" });
      expectOk(r1);
      expect(r1.body.bonusPoints).toBe(100);
      const r2 = await api("ava", "POST", `/bookings/${id}/review`, { rating: 4, body: "again" });
      expect(r2.status).toBe(409);
    },
    T,
  );

  it(
    "a booking keeps the money policy version it was created under",
    async () => {
      // A future policy (effective 2099-12-31) is the fixture: it never affects today's bookings.
      const FIXTURE_FROM = "2099-12-31T00:00:00.000Z";
      type PolicyRow = { version: number; policy: MoneyPolicy; effective_from: string };
      const read = () =>
        rest<PolicyRow>(
          null,
          "money_policies",
          "select=version,policy,effective_from&order=version",
        );
      let rows = await read();
      if (!rows.some((r) => new Date(r.effective_from).getTime() === Date.parse(FIXTURE_FROM))) {
        const fixture: MoneyPolicy = {
          ...DEFAULT_POLICY,
          clientServiceFeeBps: 2000,
          cancellation: {
            ...DEFAULT_POLICY.cancellation,
            tiers: [
              { minHoursBefore: 72, refundBps: 10_000 },
              { minHoursBefore: 24, refundBps: 5_000 },
              { minHoursBefore: 0, refundBps: 0, chargeMinutesOfRate: 60 },
            ],
          },
        };
        expectOk(
          await api("admin", "POST", "/admin/policies", {
            policy: fixture,
            effectiveFrom: FIXTURE_FROM,
            reason: "api test fixture (future policy)",
          }),
        );
        rows = await read();
      }
      const activeAt = (t: Date) =>
        rows
          .filter((r) => new Date(r.effective_from) <= t)
          .sort((a, z) => z.version - a.version)[0];
      const in2100 = new Date("2100-01-01T00:00:00Z");
      const vNow = activeAt(new Date());
      const vLater = activeAt(in2100);
      expect(vLater.version).not.toBe(vNow.version);

      // Booked today (for a January 2100 slot): snapshots today's policy.
      const s1 = slotBetween(new Date("2100-01-05T00:00:00Z"), 20);
      const b1 = await book("ava", { slot: s1, minutes: 60 });
      expectOk(b1, 201);
      expect(b1.body.booking.policy_version).toBe(vNow.version);
      expect(b1.body.booking.service_fee_cents).toBe(
        applyBps(4500, vNow.policy.clientServiceFeeBps),
      );

      // In 2100 the newer policy prices new quotes and bookings...
      const q = await api(
        "ava",
        "POST",
        "/quote",
        { taskerId: USERS.tara.id, minutes: 60 },
        { now: in2100 },
      );
      expectOk(q);
      expect(q.body.policyVersion).toBe(vLater.version);
      expect(q.body.quote.serviceFee).toBe(applyBps(4500, vLater.policy.clientServiceFeeBps));
      const s2 = slotBetween(new Date("2100-02-01T00:00:00Z"), 20);
      const b2 = await book("ava", { slot: s2, minutes: 60, now: in2100 });
      expectOk(b2, 201);
      expect(b2.body.booking.policy_version).toBe(vLater.version);

      // ...but cancelling the older booking then still uses ITS version.
      const at = hoursBefore(s1.startAt, 60);
      expect(activeAt(at).version).toBe(vLater.version);
      const money = {
        rateCents: 4500,
        subtotal: 4500,
        serviceFee: Number(b1.body.booking.service_fee_cents),
        tax: 0,
        total: Number(b1.body.booking.total_cents),
        cutoffAnchorAt: s1.startAt,
      };
      const expected = clientCancellation(money, at, vNow.policy);
      const underNewPolicy = clientCancellation(money, at, vLater.policy);
      const p = await api(
        "ava",
        "GET",
        `/bookings/${b1.body.booking.id}/cancel-preview`,
        undefined,
        { now: at },
      );
      expectOk(p);
      expect(p.body.policyVersion).toBe(vNow.version);
      expect(p.body.refund.refundCents).toBe(expected.refundCents);
      if (underNewPolicy.refundCents !== expected.refundCents)
        expect(p.body.refund.refundCents).not.toBe(underNewPolicy.refundCents);
      const c1 = await api(
        "ava",
        "POST",
        `/bookings/${b1.body.booking.id}/cancel`,
        { reason: "policy snapshot test" },
        { now: at },
      );
      expectOk(c1);
      expect(c1.body.refund.refundCents).toBe(expected.refundCents);
      expectOk(
        await api(
          "ava",
          "POST",
          `/bookings/${b2.body.booking.id}/cancel`,
          { reason: "cleanup" },
          { now: in2100 },
        ),
      );

      // Policies are never retroactive.
      const past = await api("admin", "POST", "/admin/policies", {
        policy: DEFAULT_POLICY,
        effectiveFrom: "2020-01-01T00:00:00Z",
        reason: "x",
      });
      expect(past.status).toBe(422);
    },
    T,
  );

  it(
    "payouts: concurrent runs pay once; a dispute lost after payout leaves a negative balance and blocks the next payout",
    async () => {
      const { id } = await completeFlow("ava");
      // Past the 3-day hold for everything this suite created (test-clock cancellations are dated up to
      // ~330 days ahead), so the payout sweeps the whole balance and the dispute then drives it negative.
      const afterHold = daysAfter(new Date(), 400);
      const runs = await settle(
        [1, 2].map(() => {
          const key = crypto.randomUUID();
          return () =>
            api(
              "admin",
              "POST",
              "/payouts/run",
              { taskerId: USERS.tara.id },
              { now: afterHold, idem: key },
            );
        }),
      );
      for (const r of runs) expectOk(r);
      const results = runs.map((r) =>
        r.body.payouts.find((p: Json) => p.taskerId === USERS.tara.id),
      );
      const paid = results.filter((p: Json) => p.amountCents > 0);
      expect(paid).toHaveLength(1);
      const mine = paid[0];
      expect(mine.bookingIds).toContain(id);
      expect(await taskerBalance("tara")).toBe(mine.balanceCents);
      expect(await rest("admin", "payouts", `id=eq.${mine.payoutId}`)).toHaveLength(1);

      const d = await api("admin", "POST", "/admin/disputes/simulate", {
        bookingId: id,
        outcome: "lost",
      });
      expectOk(d);
      expect(d.body.dispute).toMatchObject({
        status: "lost",
        recovered_from_tasker_cents: 7650,
        fee_cents: 1500,
      });
      expect(d.body.booking.status).toBe("disputed");
      const balance = await taskerBalance("tara");
      expect(balance).toBe(mine.balanceCents - 7650);
      expect(balance).toBeLessThan(0);
      const lines = await ledgerLinesFor(id);
      expect(
        net(
          lines.filter((l) => l.ledger_txns.kind === "dispute_lost"),
          "card_clearing",
        ),
      ).toBe(10350 + 1500);

      const p2 = await api(
        "admin",
        "POST",
        "/payouts/run",
        { taskerId: USERS.tara.id },
        { now: afterHold },
      );
      expectOk(p2);
      const blocked = p2.body.payouts.find((p: Json) => p.taskerId === USERS.tara.id);
      expect(blocked.amountCents).toBe(0);
      expect(blocked.blockedReason).toMatch(/zero or negative/);
      // A refund can't be issued on the disputed booking.
      expect(
        (
          await api("admin", "POST", `/bookings/${id}/refund`, {
            kind: "partial",
            amountCents: 100,
            reason: "x",
          })
        ).status,
      ).toBe(409);
    },
    T,
  );

  it(
    "the Stripe webhook rejects unsigned events",
    async () => {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/stripe-webhook`, {
        method: "POST",
        body: JSON.stringify({ id: "evt_x", type: "charge.dispute.created" }),
      });
      expect([400, 503]).toContain(res.status);
    },
    T,
  );

  it.skipIf(!SERVICE_ROLE_KEY)(
    "the service-role key may run payouts (cron) and nothing else",
    async () => {
      const run = await apiRaw("POST", "/payouts/run", SERVICE_ROLE_KEY, {
        taskerId: USERS.pia.id,
      });
      expectOk(run);
      expect(run.body.payouts[0]).toMatchObject({ taskerId: USERS.pia.id, amountCents: 0 });
      expect(
        (await apiRaw("POST", "/quote", SERVICE_ROLE_KEY, { taskerId: USERS.tara.id, minutes: 60 }))
          .status,
      ).toBe(403);
    },
    T,
  );

  it(
    "every money invariant holds: balanced ledger, points reconcile, no funds left held",
    async () => {
      expect(await rest("admin", "integrity_violations", "")).toEqual([]);
      expect(await rest("admin", "ledger_unbalanced_txns", "")).toEqual([]);
      const tb = await rest<{ unit: string; debits: number; credits: number }>(
        "admin",
        "ledger_trial_balance",
        "",
      );
      expect(tb.length).toBeGreaterThan(0);
      for (const row of tb) expect(Number(row.debits)).toBe(Number(row.credits));
    },
    T,
  );
});
