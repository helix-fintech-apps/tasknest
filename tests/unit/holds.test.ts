// The card-money bridge: new-contract provider methods when implemented, the legacy ones otherwise.

import {
  chargeSavedCard,
  chargeTip,
  hasLiveHold,
  placeHold,
} from "../../supabase/functions/_shared/holds.ts";
import {
  PaymentError,
  type IntentResult,
  type PaymentsProvider,
} from "../../supabase/functions/_shared/provider/types.ts";

type Calls = string[];

/** A provider whose methods are whatever the test supplies; everything else is "not implemented" like Wave 0. */
function provider(
  name: "fake" | "stripe",
  impl: Partial<PaymentsProvider>,
  calls: Calls,
): PaymentsProvider {
  const notImpl = (m: string) => () => {
    calls.push(`${m}:not_implemented`);
    throw new PaymentError("not_implemented", m, 501);
  };
  const base = {
    name,
    holdOnSession: notImpl("holdOnSession"),
    chargeOffSession: notImpl("chargeOffSession"),
    chargeOnSession: notImpl("chargeOnSession"),
    authorize: async (i: { paymentMethod?: string }) => {
      calls.push(`authorize:${i.paymentMethod}`);
      return { id: "pi_legacy_auth", status: "requires_capture", amountCents: 1 };
    },
    charge: async (i: { kind: string; paymentMethod?: string }) => {
      calls.push(`charge:${i.kind}:${i.paymentMethod}`);
      return { id: "pi_legacy_charge", status: "succeeded", amountCents: 1 };
    },
  };
  return { ...base, ...impl } as unknown as PaymentsProvider;
}

const intent = (o: Partial<IntentResult>): IntentResult => ({
  id: "pi_new",
  status: "requires_capture",
  amountCents: 8350,
  ...o,
});
const hold = {
  amountCents: 8350,
  bookingId: "b1",
  customerId: "cus_1",
  payment: null,
  savedMethodId: "pm_saved",
  idempotencyKey: "k1",
};

describe("placeHold", () => {
  it("falls back to the legacy authorize while holdOnSession is not implemented", async () => {
    const calls: Calls = [];
    const r = await placeHold(provider("fake", {}, calls), hold);
    expect(r).toEqual({ intentId: "pi_legacy_auth", status: "requires_capture" });
    expect(calls).toEqual(["holdOnSession:not_implemented", "authorize:pm_saved"]);
  });

  it("uses holdOnSession when it exists and passes the capture window through", async () => {
    const calls: Calls = [];
    const p = provider(
      "stripe",
      {
        holdOnSession: async (i) => {
          calls.push(`hold:${i.payment.kind}`);
          return intent({ chargeId: "ch_1", captureBefore: "2026-11-08T00:00:00Z" });
        },
      },
      calls,
    );
    const r = await placeHold(p, hold);
    expect(r).toMatchObject({
      intentId: "pi_new",
      chargeId: "ch_1",
      captureBefore: "2026-11-08T00:00:00Z",
    });
    expect(calls).toEqual(["hold:saved_method"]);
  });

  it("returns requires_action for the caller to hold the booking as pending_payment", async () => {
    const p = provider(
      "stripe",
      {
        holdOnSession: async () =>
          intent({ status: "requires_action", clientSecret: "pi_new_secret" }),
      },
      [],
    );
    expect(await placeHold(p, hold)).toMatchObject({
      status: "requires_action",
      clientSecret: "pi_new_secret",
    });
  });

  it("turns a declined card into a card_declined error", async () => {
    const p = provider(
      "stripe",
      {
        holdOnSession: async () =>
          intent({ status: "requires_payment_method", declineCode: "insufficient_funds" }),
      },
      [],
    );
    await expect(placeHold(p, hold)).rejects.toMatchObject({ code: "card_declined" });
  });

  it("never falls back for a new card (confirmation token): the new flow must exist", async () => {
    await expect(
      placeHold(provider("fake", {}, []), {
        ...hold,
        payment: { kind: "confirmation_token", id: "ctoken_1" },
      }),
    ).rejects.toMatchObject({ code: "not_implemented" });
  });

  it("requires a payment method and refuses simulated card ids against real Stripe", async () => {
    await expect(
      placeHold(provider("fake", {}, []), { ...hold, savedMethodId: null }),
    ).rejects.toMatchObject({
      code: "payment_method_required",
      httpStatus: 422,
    });
    await expect(
      placeHold(provider("stripe", {}, []), { ...hold, savedMethodId: "sim_pm_success" }),
    ).rejects.toMatchObject({ code: "payment_method_invalid" });
  });
});

describe("chargeSavedCard (no live hold)", () => {
  const charge = {
    amountCents: 5175,
    bookingId: "b1",
    customerId: "cus_1",
    paymentMethodId: "pm_saved",
    kind: "capture_fallback" as const,
    legacyKind: "reauth" as const,
    idempotencyKey: "b1:reauth",
    description: "d",
  };

  it("uses the legacy charge (kind reauth) until chargeOffSession exists", async () => {
    const calls: Calls = [];
    const r = await chargeSavedCard(provider("fake", {}, calls), charge);
    expect(r.intentId).toBe("pi_legacy_charge");
    expect(calls).toContain("charge:reauth:pm_saved");
  });

  it("charges off-session for exactly the amount and reports authentication_required as requires_action", async () => {
    const seen: unknown[] = [];
    const p = provider(
      "stripe",
      {
        chargeOffSession: async (i) => {
          seen.push(i);
          return intent({ status: "requires_action", clientSecret: "sec" });
        },
      },
      [],
    );
    const r = await chargeSavedCard(p, charge);
    expect(r.status).toBe("requires_action");
    expect(seen[0]).toMatchObject({
      amountCents: 5175,
      customerId: "cus_1",
      paymentMethodId: "pm_saved",
      kind: "capture_fallback",
    });
  });

  it("needs a saved card in Stripe mode", async () => {
    await expect(
      chargeSavedCard(provider("stripe", {}, []), {
        ...charge,
        customerId: null,
        paymentMethodId: null,
      }),
    ).rejects.toMatchObject({ code: "payment_method_required" });
  });
});

describe("chargeTip", () => {
  const tip = {
    amountCents: 500,
    bookingId: "b1",
    customerId: "cus_1",
    paymentMethodId: "pm_saved",
    idempotencyKey: "k",
  };

  it("falls back to legacy charge kind tip, honouring the legacy decline switch", async () => {
    const calls: Calls = [];
    await chargeTip(provider("fake", {}, calls), {
      ...tip,
      legacyMethod: "pm_card_chargeDeclined",
    });
    expect(calls).toContain("charge:tip:pm_card_chargeDeclined");
  });

  it("is an on-session charge when the provider supports it", async () => {
    const p = provider(
      "stripe",
      { chargeOnSession: async () => intent({ status: "succeeded" }) },
      [],
    );
    expect((await chargeTip(p, tip)).status).toBe("succeeded");
  });
});

describe("hasLiveHold", () => {
  const now = new Date("2026-11-10T12:00:00Z");
  const base = {
    stripe_payment_intent_id: "pi_1",
    payment_state: "hold_active" as const,
    capture_before: "2026-11-15T00:00:00Z",
    auth_expires_at: null,
  };

  it("v2: only hold_active before capture_before", () => {
    expect(hasLiveHold(base, now)).toBe(true);
    expect(hasLiveHold({ ...base, capture_before: "2026-11-10T12:00:00Z" }, now)).toBe(false);
    for (const s of [
      "card_saved",
      "hold_expired",
      "action_required",
      "captured",
      "released",
    ] as const)
      expect(hasLiveHold({ ...base, payment_state: s }, now)).toBe(false);
    expect(hasLiveHold({ ...base, stripe_payment_intent_id: null }, now)).toBe(false);
  });

  it("v1: the 7-day authorization until auth_expires_at", () => {
    const v1 = { ...base, payment_state: "none" as const, capture_before: null };
    expect(hasLiveHold({ ...v1, auth_expires_at: "2026-11-11T00:00:00Z" }, now)).toBe(true);
    expect(hasLiveHold({ ...v1, auth_expires_at: "2026-11-09T00:00:00Z" }, now)).toBe(false);
    expect(hasLiveHold({ ...v1, stripe_payment_intent_id: null }, now)).toBe(false);
  });
});
