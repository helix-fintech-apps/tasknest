// Deterministic fake provider for CI / local dev / the demo project. It never moves money.
// Object ids are derived from the idempotency key, so a retried call returns the same id.
// State (what was authorized/captured/refunded) lives in the database rows the API writes.

import {
  AuthorizeInput,
  ChargeInput,
  PaymentError,
  PaymentIntentResult,
  PaymentsProvider,
  TransferInput,
} from "./types.ts";
import { sha256Hex } from "../http.ts";

export const FAKE_DECLINE_PM = "pm_card_chargeDeclined";

async function fakeId(prefix: string, key: string): Promise<string> {
  return `${prefix}_fake_${(await sha256Hex(key)).slice(0, 24)}`;
}

function checkAmount(n: number) {
  if (!Number.isInteger(n) || n <= 0)
    throw new PaymentError(
      "invalid_amount",
      `amount must be positive integer cents, got ${n}`,
      400,
    );
}

export class FakeProvider implements PaymentsProvider {
  readonly name = "fake" as const;

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

  async transfer(i: TransferInput): Promise<{ id: string }> {
    checkAmount(i.amountCents);
    return { id: await fakeId("tr", i.idempotencyKey) };
  }
}
