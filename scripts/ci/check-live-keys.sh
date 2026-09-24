#!/usr/bin/env bash
# Guard rail for non-production deploys: refuse to continue if a live Stripe key is
# configured. TaskNest staging/preview must only ever talk to Stripe test mode.
set -euo pipefail

key="${STRIPE_SECRET_KEY:-}"
if [[ "$key" == sk_live_* || "$key" == rk_live_* ]]; then
  echo "::error::STRIPE_SECRET_KEY is a LIVE key. Staging and previews must use sk_test_ keys only."
  exit 1
fi
if [[ -n "$key" && "$key" != sk_test_* && "$key" != rk_test_* ]]; then
  echo "::error::STRIPE_SECRET_KEY does not look like a Stripe test key (sk_test_/rk_test_)."
  exit 1
fi
echo "Stripe key check passed (${key:+test key present}${key:-no key configured, fake provider will be used})."
