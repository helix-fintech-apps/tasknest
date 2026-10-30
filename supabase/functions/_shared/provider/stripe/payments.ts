// Stripe payments methods. Owned by WS4: the legacy methods below keep today's behaviour; the new-contract
// methods (docs/contracts.md 4.4) are stubs until WS4 implements them.

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
import { StripeHttp } from "./http.ts";

export class StripePayments {
  constructor(private http: StripeHttp) {}

  // ---- Deprecated wrappers (unchanged behaviour) ----

  async authorize(i: AuthorizeInput): Promise<PaymentIntentResult> {
    const pi = await this.http.post<{ id: string; status: string; amount: number }>(
      "/payment_intents",
      {
        amount: i.amountCents,
        currency: "usd",
        capture_method: "manual",
        confirm: true,
        payment_method: i.paymentMethod ?? "pm_card_visa",
        payment_method_types: ["card"],
        description: i.description,
        transfer_group: i.bookingId,
        metadata: { booking_id: i.bookingId, kind: "booking" },
      },
      i.idempotencyKey,
    );
    if (pi.status !== "requires_capture")
      throw new PaymentError("authorization_failed", `authorization status ${pi.status}`);
    return { id: pi.id, status: pi.status, amountCents: pi.amount };
  }

  async capture(
    paymentIntentId: string,
    amountCents: number,
    idempotencyKey: string,
  ): Promise<PaymentIntentResult> {
    const pi = await this.http.post<{ id: string; status: string; amount_received: number }>(
      `/payment_intents/${paymentIntentId}/capture`,
      { amount_to_capture: amountCents },
      idempotencyKey,
    );
    return { id: pi.id, status: pi.status, amountCents: pi.amount_received };
  }

  async cancel(paymentIntentId: string, idempotencyKey: string): Promise<void> {
    await this.http.post(`/payment_intents/${paymentIntentId}/cancel`, {}, idempotencyKey);
  }

  async charge(i: ChargeInput): Promise<PaymentIntentResult> {
    const pi = await this.http.post<{ id: string; status: string; amount: number }>(
      "/payment_intents",
      {
        amount: i.amountCents,
        currency: "usd",
        confirm: true,
        payment_method: i.paymentMethod ?? "pm_card_visa",
        payment_method_types: ["card"],
        description: i.description,
        transfer_group: i.bookingId,
        metadata: { booking_id: i.bookingId, kind: i.kind },
      },
      i.idempotencyKey,
    );
    if (pi.status !== "succeeded")
      throw new PaymentError("charge_failed", `charge status ${pi.status}`);
    return { id: pi.id, status: pi.status, amountCents: pi.amount };
  }

  async refund(
    paymentIntentId: string,
    amountCents: number,
    idempotencyKey: string,
  ): Promise<{ id: string }> {
    const r = await this.http.post<{ id: string }>(
      "/refunds",
      { payment_intent: paymentIntentId, amount: amountCents },
      idempotencyKey,
    );
    return { id: r.id };
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
