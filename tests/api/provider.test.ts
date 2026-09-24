// Offline tests for the payments provider layer (no network, always run).

import {
  FakeProvider,
  FAKE_DECLINE_PM,
  PaymentError,
  selectProvider,
  StripeProvider,
  formEncode,
  hmacSha256Hex,
  verifyStripeSignature,
} from "../../supabase/functions/_shared/provider/index.ts";

describe("provider selection", () => {
  it("refuses live Stripe keys", () => {
    expect(() => selectProvider({ STRIPE_SECRET_KEY: "sk_live_abc" })).toThrow(/live key/);
    expect(() =>
      selectProvider({ PAYMENTS_PROVIDER: "fake", STRIPE_SECRET_KEY: "sk_live_abc" }),
    ).toThrow(/live key/);
    expect(() => new StripeProvider("sk_live_abc")).toThrow(/live/);
  });
  it("uses fake without a key, stripe with a test key, and honors PAYMENTS_PROVIDER", () => {
    expect(selectProvider({}).name).toBe("fake");
    expect(selectProvider({ STRIPE_SECRET_KEY: "sk_test_123" }).name).toBe("stripe");
    expect(
      selectProvider({ PAYMENTS_PROVIDER: "fake", STRIPE_SECRET_KEY: "sk_test_123" }).name,
    ).toBe("fake");
    expect(() => selectProvider({ PAYMENTS_PROVIDER: "stripe" })).toThrow(/not set/);
    expect(() => selectProvider({ PAYMENTS_PROVIDER: "paypal" })).toThrow(/unknown/);
  });
});

describe("fake provider", () => {
  const p = new FakeProvider();
  it("is deterministic per idempotency key", async () => {
    const a = await p.authorize({
      amountCents: 1000,
      bookingId: "b1",
      description: "x",
      idempotencyKey: "k1",
    });
    const b = await p.authorize({
      amountCents: 1000,
      bookingId: "b1",
      description: "x",
      idempotencyKey: "k1",
    });
    const c = await p.authorize({
      amountCents: 1000,
      bookingId: "b1",
      description: "x",
      idempotencyKey: "k2",
    });
    expect(a.id).toBe(b.id);
    expect(a.id).not.toBe(c.id);
    expect(a.status).toBe("requires_capture");
  });
  it("simulates declines and rejects non-integer amounts", async () => {
    await expect(
      p.authorize({
        amountCents: 1000,
        bookingId: "b",
        description: "x",
        idempotencyKey: "k",
        paymentMethod: FAKE_DECLINE_PM,
      }),
    ).rejects.toBeInstanceOf(PaymentError);
    await expect(
      p.charge({
        amountCents: 10.5,
        bookingId: "b",
        description: "x",
        idempotencyKey: "k",
        kind: "tip",
      }),
    ).rejects.toThrow(/integer/);
  });
});

describe("stripe helpers", () => {
  it("form-encodes nested params the way Stripe expects", () => {
    const s = formEncode({
      amount: 500,
      capture_method: "manual",
      payment_method_types: ["card"],
      metadata: { booking_id: "b1" },
      skip: undefined,
    });
    expect(decodeURIComponent(s)).toBe(
      "amount=500&capture_method=manual&payment_method_types[]=card&metadata[booking_id]=b1",
    );
  });
  it("verifies webhook signatures (HMAC SHA-256 over `t.payload`) with a tolerance", async () => {
    const secret = "whsec_test";
    const body = JSON.stringify({ id: "evt_1", type: "charge.dispute.created" });
    const t = 1_800_000_000;
    const sig = await hmacSha256Hex(secret, `${t}.${body}`);
    expect(await verifyStripeSignature(body, `t=${t},v1=${sig}`, secret, t + 10)).toBe(true);
    expect(await verifyStripeSignature(body, `t=${t},v1=${sig}`, secret, t + 1000)).toBe(false); // too old
    expect(await verifyStripeSignature(body + " ", `t=${t},v1=${sig}`, secret, t)).toBe(false); // tampered
    expect(await verifyStripeSignature(body, `t=${t},v1=${sig}`, "whsec_other", t)).toBe(false);
    expect(await verifyStripeSignature(body, null, secret, t)).toBe(false);
  });
});
