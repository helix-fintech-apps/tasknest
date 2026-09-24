#!/usr/bin/env bash
# Guard rail for non-production deploys: refuse to continue if a live Stripe key is
# configured. TaskNest staging/preview must only ever talk to Stripe test mode.
#
# The key itself is never printed: only its kind (the public "sk_test_"-style prefix). In GitHub
# Actions it is also registered as a secret mask, so no later step can echo it by accident.
set -euo pipefail

key="${STRIPE_SECRET_KEY:-}"
if [[ -n "$key" && -n "${GITHUB_ACTIONS:-}" ]]; then
  echo "::add-mask::$key"
fi

if [[ "$key" == sk_live_* || "$key" == rk_live_* ]]; then
  echo "::error::STRIPE_SECRET_KEY is a LIVE key. Staging and previews must use sk_test_ keys only."
  exit 1
fi
if [[ -n "$key" && "$key" != sk_test_* && "$key" != rk_test_* ]]; then
  echo "::error::STRIPE_SECRET_KEY does not look like a Stripe test key (sk_test_/rk_test_)."
  exit 1
fi
if [[ -n "$key" ]]; then
  echo "Stripe key check passed (${key:0:8}… test key present; value not shown)."
else
  echo "Stripe key check passed (no key configured, fake provider will be used)."
fi
