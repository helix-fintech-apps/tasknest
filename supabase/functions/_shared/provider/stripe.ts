// Stripe (test mode) via the REST API: form-encoded requests with Idempotency-Key headers.

import {
  AuthorizeInput,
  ChargeInput,
  PaymentError,
  PaymentIntentResult,
  PaymentsProvider,
  TransferInput,
} from "./types.ts";

const API = "https://api.stripe.com/v1";

type Params = Record<
  string,
  string | number | boolean | undefined | string[] | Record<string, string>
>;

/** Encode params the way Stripe expects: `metadata[booking_id]=...`, `payment_method_types[]=card`. */
export function formEncode(params: Params): string {
  const out = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined) continue;
    if (Array.isArray(v)) {
      for (const item of v) out.append(`${k}[]`, item);
    } else if (typeof v === "object") {
      for (const [sk, sv] of Object.entries(v)) out.append(`${k}[${sk}]`, String(sv));
    } else {
      out.append(k, String(v));
    }
  }
  return out.toString();
}

export class StripeProvider implements PaymentsProvider {
  readonly name = "stripe" as const;

  constructor(private secretKey: string) {
    if (secretKey.startsWith("sk_live_") || secretKey.startsWith("rk_live_")) {
      throw new Error("refusing to run with a live Stripe key");
    }
    if (!secretKey.startsWith("sk_test_") && !secretKey.startsWith("rk_test_")) {
      throw new Error("STRIPE_SECRET_KEY must be a test-mode key (sk_test_...)");
    }
  }

  private async post<T>(path: string, params: Params, idempotencyKey: string): Promise<T> {
    const body = formEncode(params);
    const res = await fetch(`${API}${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.secretKey}`,
        "Content-Type": "application/x-www-form-urlencoded",
        "Idempotency-Key": idempotencyKey,
        "Stripe-Version": "2024-06-20",
      },
      body,
    });
    const data = await res.json();
    if (!res.ok) {
      const err = data?.error ?? {};
      const code = err.decline_code ?? err.code ?? "stripe_error";
      throw new PaymentError(
        code,
        err.message ?? `Stripe error ${res.status}`,
        res.status === 402 ? 402 : 502,
      );
    }
    return data as T;
  }

  async authorize(i: AuthorizeInput): Promise<PaymentIntentResult> {
    const pi = await this.post<{ id: string; status: string; amount: number }>(
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
    const pi = await this.post<{ id: string; status: string; amount_received: number }>(
      `/payment_intents/${paymentIntentId}/capture`,
      { amount_to_capture: amountCents },
      idempotencyKey,
    );
    return { id: pi.id, status: pi.status, amountCents: pi.amount_received };
  }

  async cancel(paymentIntentId: string, idempotencyKey: string): Promise<void> {
    await this.post(`/payment_intents/${paymentIntentId}/cancel`, {}, idempotencyKey);
  }

  async charge(i: ChargeInput): Promise<PaymentIntentResult> {
    const pi = await this.post<{ id: string; status: string; amount: number }>(
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
    const r = await this.post<{ id: string }>(
      "/refunds",
      { payment_intent: paymentIntentId, amount: amountCents },
      idempotencyKey,
    );
    return { id: r.id };
  }

  async transfer(i: TransferInput): Promise<{ id: string }> {
    const t = await this.post<{ id: string }>(
      "/transfers",
      {
        amount: i.amountCents,
        currency: "usd",
        destination: i.destination,
        metadata: { payout_id: i.payoutId },
      },
      i.idempotencyKey,
    );
    return { id: t.id };
  }
}

// ---- Webhook signature verification (Stripe-Signature: t=...,v1=...) -------------------------

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

export async function hmacSha256Hex(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function verifyStripeSignature(
  rawBody: string,
  header: string | null,
  secret: string,
  nowSec: number,
  toleranceSec = 300,
): Promise<boolean> {
  if (!header) return false;
  const parts = header.split(",").map((p) => p.trim().split("=") as [string, string]);
  const t = parts.find(([k]) => k === "t")?.[1];
  const sigs = parts.filter(([k]) => k === "v1").map(([, v]) => v);
  if (!t || sigs.length === 0) return false;
  const ts = Number(t);
  if (!Number.isFinite(ts) || Math.abs(nowSec - ts) > toleranceSec) return false;
  const expected = await hmacSha256Hex(secret, `${t}.${rawBody}`);
  return sigs.some((s) => timingSafeEqual(s, expected));
}
