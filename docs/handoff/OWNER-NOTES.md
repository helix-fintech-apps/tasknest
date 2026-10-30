# Owner decisions for the TaskNest build
- Owner (verbatim, 29 Oct): "we will use simulated keys".
  - Apps run on simulated providers by default: no real Stripe or Modern Treasury keys.
  - TaskNest: build the Stripe integration correctly per the official docs, but the default runtime is the deterministic `fake` provider. That includes a simulated card form that mirrors the Payment Element flow (test card numbers, the 3DS challenge, declines), simulated Connect onboarding, simulated webhooks, and simulated payouts, so every screen works end to end with no keys.
  - Real Stripe test mode switches on only when the owner sets keys later.
  - Every simulated step is labeled "Simulated" on screen.
