// Fake payments methods (never moves money). Owned by WS4: the legacy methods keep today's behaviour; the
// new-contract methods (docs/contracts.md 4.4) are stubs until WS4 implements them.

import {
  AuthorizeInput,
  ChargeInput,
  IntentResult,
  Method,
  notImplemented,
  PaymentError,
  PaymentInput,
  PaymentIntentResult,
  SetupResult,
} from "../types.ts";
import { checkAmount, FAKE_DECLINE_PM, fakeId } from "./scenarios.ts";

export class FakePayments {
  // ---- Deprecated wrappers (unchanged behaviour) ----

  async authorize(i: AuthorizeInput): Promise<PaymentIntentResult> {
    checkAmount(i.amountCents);
    if (i.paymentMethod === FAKE_DECLINE_PM)
      throw new PaymentError("card_declined", "Your card was declined.");
    return {
      id: await fakeId("pi", `auth:${i.idempotencyKey}`),
      status: "requires_capture",
      amountCents: i.amountCents,
    };
  }

  async capture(
    paymentIntentId: string,
    amountCents: number,
    _key: string,
  ): Promise<PaymentIntentResult> {
    checkAmount(amountCents);
    return { id: paymentIntentId, status: "succeeded", amountCents };
  }

  async cancel(_paymentIntentId: string, _key: string): Promise<void> {}

  async charge(i: ChargeInput): Promise<PaymentIntentResult> {
    checkAmount(i.amountCents);
    if (i.paymentMethod === FAKE_DECLINE_PM)
      throw new PaymentError("card_declined", "Your card was declined.");
    return {
      id: await fakeId("pi", `charge:${i.kind}:${i.idempotencyKey}`),
      status: "succeeded",
      amountCents: i.amountCents,
    };
  }

  async refund(_pi: string, amountCents: number, key: string): Promise<{ id: string }> {
    checkAmount(amountCents);
    return { id: await fakeId("re", key) };
  }

  // ---- New contract (WS4) ----

  ensureCustomer(_userId: string, _email: string): Promise<{ customerId: string }> {
    return notImplemented("ensureCustomer");
  }
  customerSession(_customerId: string): Promise<{ clientSecret: string } | { simulated: true }> {
    return notImplemented("customerSession");
  }
  holdOnSession(_i: {
    amountCents: number;
    customerId: string;
    payment: PaymentInput;
    bookingId: string;
    idempotencyKey: string;
  }): Promise<IntentResult> {
    return notImplemented("holdOnSession");
  }
  setupOnSession(_i: {
    customerId: string;
    payment: PaymentInput;
    idempotencyKey: string;
  }): Promise<SetupResult> {
    return notImplemented("setupOnSession");
  }
  holdOffSession(_i: {
    amountCents: number;
    customerId: string;
    paymentMethodId: string;
    bookingId: string;
    kind: "hold" | "rehold";
    idempotencyKey: string;
  }): Promise<IntentResult> {
    return notImplemented("holdOffSession");
  }
  chargeOffSession(_i: {
    amountCents: number;
    customerId: string;
    paymentMethodId: string;
    bookingId: string;
    kind: "extras" | "fee" | "capture_fallback";
    idempotencyKey: string;
  }): Promise<IntentResult> {
    return notImplemented("chargeOffSession");
  }
  chargeOnSession(_i: {
    amountCents: number;
    customerId: string;
    paymentMethodId: string;
    bookingId: string;
    kind: "tip";
    idempotencyKey: string;
  }): Promise<IntentResult> {
    return notImplemented("chargeOnSession");
  }
  retrieveIntent(_id: string): Promise<IntentResult> {
    return notImplemented("retrieveIntent");
  }
  listMethods(_customerId: string): Promise<Method[]> {
    return notImplemented("listMethods");
  }
  detachMethod(_pmId: string): Promise<void> {
    return notImplemented("detachMethod");
  }
}
