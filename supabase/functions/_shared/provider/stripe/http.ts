// Stripe (test mode) REST transport: form-encoded requests with Idempotency-Key headers, plus webhook
// signature verification. Shared by stripe/payments.ts and stripe/connect.ts.

import { PaymentError } from "../types.ts";

const API = "https://api.stripe.com/v1";

export type Params = Record<
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

/** Authenticated Stripe client. Refuses live keys at construction. */
export class StripeHttp {
  constructor(private secretKey: string) {
    if (secretKey.startsWith("sk_live_") || secretKey.startsWith("rk_live_")) {
      throw new Error("refusing to run with a live Stripe key");
    }
    if (!secretKey.startsWith("sk_test_") && !secretKey.startsWith("rk_test_")) {
      throw new Error("STRIPE_SECRET_KEY must be a test-mode key (sk_test_...)");
    }
  }

  async post<T>(path: string, params: Params, idempotencyKey: string): Promise<T> {
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
