// Public Stripe webhook endpoint (deployed with verify_jwt = false: Stripe sends no Supabase JWT).
// Authenticated by the Stripe-Signature header (HMAC SHA-256 with STRIPE_WEBHOOK_SECRET).
// Endpoint URL: https://<project-ref>.supabase.co/functions/v1/stripe-webhook

import { corsHeaders, errorBody, json, toHttpError } from "../_shared/http.ts";
import { serviceClient } from "../_shared/db.ts";
import { handleStripeWebhook } from "../_shared/stripe-webhook.ts";

async function handle(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(errorBody("method_not_allowed", "POST only"), 405);
  try {
    return await handleStripeWebhook(req, serviceClient());
  } catch (e) {
    const h = toHttpError(e);
    return json(errorBody(h.code, h.message), h.status);
  }
}

const D = (globalThis as { Deno?: { serve?: (h: (req: Request) => Promise<Response>) => unknown } })
  .Deno;
if (D?.serve) D.serve(handle);
