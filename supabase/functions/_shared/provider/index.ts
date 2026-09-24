// Chooses the payments provider from the environment.
//   PAYMENTS_PROVIDER=fake|stripe (optional). Default: stripe when STRIPE_SECRET_KEY is a test key, else fake.
//   A live key (sk_live_...) is always refused.

import { FakeProvider } from "./fake.ts";
import { StripeProvider } from "./stripe.ts";
import { PaymentsProvider } from "./types.ts";

export * from "./types.ts";
export { FakeProvider, FAKE_DECLINE_PM } from "./fake.ts";
export { StripeProvider, verifyStripeSignature, hmacSha256Hex, formEncode } from "./stripe.ts";

export function selectProvider(env: {
  PAYMENTS_PROVIDER?: string;
  STRIPE_SECRET_KEY?: string;
}): PaymentsProvider {
  const key = env.STRIPE_SECRET_KEY ?? "";
  if (key.startsWith("sk_live_") || key.startsWith("rk_live_")) {
    throw new Error(
      "refusing to start: STRIPE_SECRET_KEY is a live key; TaskNest only runs against Stripe test mode",
    );
  }
  const wanted = (env.PAYMENTS_PROVIDER ?? "").toLowerCase();
  if (wanted === "fake") return new FakeProvider();
  if (wanted === "stripe") {
    if (!key) throw new Error("PAYMENTS_PROVIDER=stripe but STRIPE_SECRET_KEY is not set");
    return new StripeProvider(key);
  }
  if (wanted && wanted !== "auto") throw new Error(`unknown PAYMENTS_PROVIDER ${wanted}`);
  return key.startsWith("sk_test_") ? new StripeProvider(key) : new FakeProvider();
}
