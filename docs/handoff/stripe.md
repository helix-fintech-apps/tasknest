# TaskNest x Stripe: correct current approach and gap analysis

- Repo: `helix-fintech-apps/tasknest` at `65a45d8` (2026-09-25), read-only.
- Docs fetched: 2026-10-29. All Stripe facts below come from docs.stripe.com (plus one support.stripe.com fee page), and each one is cited inline. The full source list is in section 9.
- Files reviewed: `supabase/functions/_shared/provider/{stripe,types,index,fake}.ts`, `_shared/stripe-webhook.ts`, `_shared/disputes.ts`, `stripe-webhook/index.ts`, `api/handlers/{bookings,money,admin}.ts`, `docs/BACKEND_NOTES.md` (Payments providers; Refunds, disputes, payouts), `docs/API.md`, `supabase/config.toml`, `scripts/ci/check-live-keys.sh`, `tests/api/provider.test.ts`, `package.json`, `src/` (contains no Stripe code).

---

## 0. Verdict (TL;DR)

The repo has a sound foundation:

- integer cents
- a double-entry ledger
- provider idempotency keys
- a manual-capture hold at booking
- partial capture
- live-key refusal
- a hand-rolled webhook signature check, which is correct

It is not yet a working Stripe integration, for these reasons:

1. **There is no client-side card collection.** `src/` has no Stripe.js or Payment Element. The API accepts a raw `paymentMethod` string, and the server silently falls back to the test PaymentMethod `pm_card_visa` (`stripe.ts:80,117`).
2. **There are no Customers and no saved cards.** Extras and re-authorizations at completion are charged with no customer and no payment method (`bookings.ts:739-761`). Against real Stripe they would charge `pm_card_visa`, not the client's card. Off-session charging (`off_session=true`, `authentication_required` recovery) is missing.
3. **The pinned API version `2024-06-20` predates the current release process.** The current version is **`2026-10-28.endive`**. Endive *removes* `payment_method_types` from PaymentIntents, and the repo sends it on every PaymentIntent (`stripe.ts:81,118`). Upgrading without changing the code returns 400 `payment_method_types_no_longer_supported`.
4. **Connect is a stub.** The repo has:
   - no connected-account creation
   - no onboarding link
   - no capability check
   - placeholder `acct_fake_*` ids
   - a "payout" that is really a `/v1/transfers` call, marked `paid` immediately
   - no `source_transaction` and no `transfer_group` on transfers
5. **Webhooks cover only `charge.dispute.*`.** Missing:
   - `payment_intent.*` (holds expiring, failures)
   - `refund.*` / `charge.refunded` (async refund failure)
   - `account.updated` / v2 account events (KYC)
   - `payout.*` (bank payout failures on connected accounts)
   - the Connect-scope endpoint
   - any `livemode` check
6. **Dispute economics are wrong.**
   - Stripe debits the disputed amount plus a non-refundable $15 fee when the dispute *opens*. A $15 countered fee also applies, and is returned if TaskNest wins ([how disputes work](https://docs.stripe.com/disputes/how-disputes-work), [US fees](https://support.stripe.com/questions/june-2025-pricing-updates-for-disputes)).
   - The repo books a $15 fee only when the dispute is *lost* (`disputes.ts:19,73-104`).
   - The ledger has no entries for Stripe processing fees.

**Recommended shape:**

- **Payments:** Payment Element with a deferred intent, plus ConfirmationTokens. The server creates the manual-capture PaymentIntent with `customer` and `setup_future_usage=off_session`.
- **Charge type:** Separate charges and transfers (SCT). This fits the existing ledger: `tasker_payable`, hold days, clawback netting and platform-funded tenders.
- **Connected accounts:** Accounts v2 with the `recipient` configuration, `dashboard: "express"`, and `fees_collector`/`losses_collector = "application"`. Onboard with v2 Account Links, *without* `configurations` on endive.
- **API version:** pin `Stripe-Version: 2026-10-28.endive` for v1 calls, and create webhook endpoints on the same version.

---

## 1. What the repo does today (inventory)

| Concern | Where | Behavior |
|---|---|---|
| Transport | `stripe.ts:47-70` | Raw `fetch` with form encoding. Sends `Idempotency-Key` on every POST, plus `Stripe-Version: 2024-06-20` (line 55). Non-402 errors are mapped to 502 (line 66). |
| Hold at booking | `stripe.ts:72-91`, `bookings.ts:244-254` | `POST /v1/payment_intents` with `capture_method=manual`, `confirm=true`, `payment_method = i.paymentMethod ?? "pm_card_visa"`, `payment_method_types[]=card`, and `transfer_group=bookingId`. Any status other than `requires_capture` throws. `auth_expires_at` is computed as now + `policy.auth.validityDays` (7). |
| Void | `stripe.ts:106-108`; `bookings.ts:321,464,568` | `/cancel`. Errors are swallowed by `.catch(() => {})`. |
| Capture | `stripe.ts:93-104`; `bookings.ts:456-460, 734-749` | `amount_to_capture`, a single capture, key `${b.id}:capture`. If `auth_expires_at` has passed, the code instead calls `charge()` (kind `reauth`) with **no payment method**. |
| Extras / tips | `bookings.ts:752-762`; `money.ts:57-64` | Separate automatic-capture PaymentIntents. Extras pass no payment method. Tips use the raw `paymentMethod` from the request body. |
| Refunds | `stripe.ts:130-141`; `money.ts:292-314` | `/v1/refunds` with `payment_intent` + `amount`: the main PaymentIntent first, then the extras PaymentIntent. Tip PaymentIntents are never refunded. |
| Payouts | `stripe.ts:143-155`; `admin.ts:109-136` | `/v1/transfers` with `destination = taskers.stripe_account_id`, with no `transfer_group` and no `source_transaction`. The `payouts` row is written `status: "paid"` immediately. |
| Webhook | `_shared/stripe-webhook.ts`, `stripe-webhook/index.ts`, `config.toml` (`verify_jwt=false`) | Reads the raw body with `req.text()` (line 139) and verifies HMAC-SHA256 over `t.payload`, with 300 s tolerance, a constant-time compare, and support for multiple `v1` values. Dedupe uses `stripe_events.id` in the same transaction. Handles only `charge.dispute.{created,updated,closed}` (line 15); everything else is recorded and ignored (line 113). |
| Live-key refusal | `provider/index.ts:18-22`, `stripe.ts:39-44`, `scripts/ci/check-live-keys.sh` | Refuses `sk_live_` and `rk_live_`, and requires `sk_test_` or `rk_test_`. CI masks the key. |
| Frontend | `src/` | No `@stripe/stripe-js` or `@stripe/react-stripe-js` in `package.json`, and no card UI. |

---

## 2. Correct current approach (from the docs)

### 2.1 API version to pin

- "The current version is **2026-10-28.endive**." Stripe releases monthly versions with no breaking changes, and twice a year a new major release whose first version has breaking changes. Without the `Stripe-Version` header, curl and raw HTTP use the account default. Webhook events use the version set when the endpoint was created, otherwise the account default. ([versioning](https://docs.stripe.com/api/versioning))
- Endive's first version is `2026-09-30.endive` ("introduces both breaking changes and new features"). Two breaking changes hit TaskNest directly ([Endive changelog](https://docs.stripe.com/changelog/endive)):
  - **`payment_method_types` is removed** from create, update and confirm on PaymentIntents and SetupIntents. Requests that pass it get a 400 with code `payment_method_types_no_longer_supported`. The replacements are dynamic payment methods, `excluded_payment_method_types`, or `allowed_payment_method_types`. ([change note](https://docs.stripe.com/changelog/endive/2026-09-30/removes-the-payment-method-types-parameter-from-payment-intents-and-setup-intents))
  - **`configurations` is removed from v2 Account Links** (`use_case.account_onboarding` and `account_update`): "Stripe now automatically determines which configurations require onboarding." ([change note](https://docs.stripe.com/changelog/endive/2026-09-30/removes-configurations-parameter-from-v2-core-account-links-api))
  - The Elements `paymentMethodTypes` option is also removed. Use `allowedPaymentMethodTypes` instead.
- **Pin:** `Stripe-Version: 2026-10-28.endive` on every v1 request. Create the webhook endpoint(s) with the same API version.
  - The docs' v2 curl examples (`/v2/core/accounts`, `/v2/core/event_destinations`) show `Stripe-Version: 2026-10-28.preview` ([accounts-v2](https://docs.stripe.com/connect/accounts-v2), [webhooks](https://docs.stripe.com/webhooks)).
  - Using the official SDK pins the matching version for you: "Starting from `stripe-node v12`, the requests you send … align with the API version that was current when your version of `stripe-node` was released" ([versioning](https://docs.stripe.com/api/versioning)).
  - npm registry today: `stripe@23.1.0`, `@stripe/stripe-js@10.2.0`, `@stripe/react-stripe-js@7.0.1`. Pin exact versions.

### 2.2 Payment Element with Stripe.js / React Stripe.js

- Install `@stripe/react-stripe-js` and `@stripe/stripe-js`. "Call `loadStripe` outside of a component's render." Wrap the checkout in `<Elements stripe={stripePromise} options={…}>` and render `<PaymentElement />`. Load Stripe.js only from js.stripe.com ("Don't include the script in a bundle or host a copy of it yourself"); the endive script URL is `https://js.stripe.com/endive/stripe.js`. ([destination charges, custom flow](https://docs.stripe.com/connect/destination-charges.md?platform=web&ui=elements), [finalize on server](https://docs.stripe.com/payments/finalize-payments-on-the-server.md?platform=web&type=payment))
- **The TaskNest server owns the price** (quote, tenders, points), so use the **deferred-intent, finalize-on-server** flow ([finalize payments on the server](https://docs.stripe.com/payments/finalize-payments-on-the-server.md?platform=web&type=payment)):
  - Client: `Elements` options `{ mode: 'payment', amount, currency: 'usd', captureMethod: 'manual', setupFutureUsage: 'off_session' }`. "Make sure the Elements options you provide (such as `captureMethod`, `setupFutureUsage` …) match the equivalent parameters you pass when creating and confirming the Intent."
  - On submit: `await elements.submit()`, then `stripe.createConfirmationToken({ elements, params })`, then send `confirmationToken.id` to the server. "You must immediately use the created ConfirmationToken … if unused, it expires after 12 hours."
  - Server: `POST /v1/payment_intents` with `confirm=true`, `amount`, `currency`, `confirmation_token`. Return `{client_secret, status}`.
  - Client: if `status === "requires_action"`, call `stripe.handleNextAction({ clientSecret })` (3DS).
- Saved cards in the Element: create a **CustomerSession** (`customer` or `customer_account`) with `components.payment_element.features` (`payment_method_save`, `payment_method_redisplay`, …), and pass `customerSessionClientSecret` to Elements. ([finalize on server, optional section](https://docs.stripe.com/payments/finalize-payments-on-the-server.md?platform=web&type=payment))
- Docs note: Stripe now recommends Checkout Sessions (`ui_mode: "elements"`) for most integrations. Payment Intents remain fully supported and give the control this marketplace needs (manual capture, SCT, off-session extras). ([lifecycle](https://docs.stripe.com/payments/paymentintents/lifecycle))
- Listen for `payment_intent.succeeded`, `payment_intent.processing` and `payment_intent.payment_failed` rather than trusting the client callback ([destination charges, custom flow](https://docs.stripe.com/connect/destination-charges.md?platform=web&ui=elements)).

### 2.3 Hold at booking: `capture_method=manual` and its limits

- Set `capture_method=manual` (or `payment_method_options[card][capture_method]=manual`). After confirmation the status is `requires_capture`. Capture with `amount_to_capture`; "A partial capture automatically releases the remaining amount." For most payments "you can only perform one capture"; for later charges, save the card and create new payments. `payment_intent.amount_capturable_updated` fires when the hold is placed. ([place a hold](https://docs.stripe.com/payments/place-a-hold-on-a-payment-method))
- **Validity windows (card-not-present):**

  | Brand | MIT | CIT |
  |---|---|---|
  | Visa | 5 days\* | 7 days |
  | Mastercard | 7 days | 7 days |
  | Amex | 7 days | 7 days |
  | Discover | 7 days | 7 days |

  \* "The exact authorization window is 4 days and 18 hours." Classification uses network signals, not just `off_session`.
- "If the authorization expires before you capture the funds, the funds are released and the payment status changes to `canceled`." The authoritative deadline is **`latest_charge.payment_method_details.card.capture_before`**. ([place a hold](https://docs.stripe.com/payments/place-a-hold-on-a-payment-method))
- **Extended authorization:** `payment_method_options[card][request_extended_authorization]=if_available`, up to 30 days. It is IC+ pricing only, CIT only for Visa "other" merchant categories (+0.08%), and Amex/Discover are limited to lodging/rental/travel merchant categories. Check `extended_authorization.status` and `capture_before`. ([extended auth](https://docs.stripe.com/payments/extended-authorization.md?platform=web&ui=elements)) This is probably not available to a services marketplace on blended pricing, so don't depend on it.
- `automatic_delayed` capture is private preview only ([place a hold](https://docs.stripe.com/payments/place-a-hold-on-a-payment-method)).
- Cancel the hold with `POST /v1/payment_intents/:id/cancel`. A `requires_capture` PaymentIntent "can't be refunded directly. You must cancel." ([refunds](https://docs.stripe.com/refunds))
- **Design consequence for TaskNest:** bookings can be made more than 5–7 days ahead. Recommended pattern:
  - At booking, if the start is within the window, place the hold on-session (CIT, 7 days) **and** save the card (`setup_future_usage=off_session`, `customer`).
  - If the start is beyond about 4 days, save the card only (SetupIntent, or `mode: 'setup'` in Elements). Then a scheduled job places the off-session hold shortly before the start, budgeting for the Visa MIT window of 4 d 18 h.
  - Always store `capture_before` from the charge, not `now + 7d`.
  - **TaskRabbit (UX pattern only):** for General Marketplace web bookings, TaskRabbit charges a one-hour deposit right after booking, charges extra time separately, and processes the final invoice 24 h after the invoice is submitted ([support.taskrabbit.com](https://support.taskrabbit.com/hc/en-us/articles/46260462243611-Why-Was-I-Charged-Right-After-Booking)). TaskNest's hold-then-capture is a valid alternative, but the UI must disclose it.

### 2.4 Saved cards: SetupIntents and off-session extras

- Compliance: state in your terms how saved details are used, collect explicit consent (for example a "Save my payment method for future use" checkbox), and keep a record of it. ([save during payment](https://docs.stripe.com/payments/save-during-payment.md?payment-ui=elements), [save and reuse](https://docs.stripe.com/payments/save-and-reuse.md?payment-ui=elements))
- Save during the booking payment with `setup_future_usage=off_session` (or `payment_method_options[card][setup_future_usage]=off_session`) on a PaymentIntent that has `customer` (v1 Customer) or `customer_account` (v2 Account with the `customer` configuration). Without a payment, use a SetupIntent (`usage=off_session`). ([save during payment](https://docs.stripe.com/payments/save-during-payment.md?payment-ui=elements), [accounts-v2](https://docs.stripe.com/connect/accounts-v2))
- **Charge later off-session** (extras, re-hold, tip if desired): create a PaymentIntent with `customer` or `customer_account`, `payment_method=pm_…`, `off_session=true` and `confirm=true` (the docs' example also passes `return_url`). "If the conditions for exemption aren't met, the PaymentIntent might throw an error." ([save during payment](https://docs.stripe.com/payments/save-during-payment.md?payment-ui=elements))
- **`authentication_required`:** "If the payment failed due to an authentication_required decline code, use the declined PaymentIntent's client secret with confirmPayment to allow the customer to authenticate the payment." ([save and reuse](https://docs.stripe.com/payments/save-and-reuse.md?payment-ui=elements)) TaskNest therefore needs a "Payment needs your approval" state on the booking and a notification that brings the client back on-session.
- Test cards ([testing](https://docs.stripe.com/testing)):
  - `4000002500003155` / `pm_card_authenticationRequiredOnSetup`: authenticate at setup, then off-session succeeds.
  - `4000002760003184` / `pm_card_authenticationRequired`: always requires authentication, so off-session fails with `authentication_required`.
  - `4000003800000446`: off-session succeeds as if already set up.

### 2.5 Connect for taskers

- **Account model.** Legacy account types (Standard/Express/Custom) are marked "Deprecated feature" for new platforms. Use the **Accounts v2 API**, or v1 with **controller properties**. ([account types](https://docs.stripe.com/connect/accounts), [migrate to controller properties](https://docs.stripe.com/connect/migrate-to-controller-properties))
  - The marketplace quickstart (Accounts v2) creates the seller as:
    ```json
    { "dashboard": "express",
      "defaults": { "responsibilities": { "fees_collector": "application", "losses_collector": "application" } },
      "identity": { "country": "US", "entity_type": "…" },
      "configuration": { "recipient": { "capabilities": { "stripe_balance": { "stripe_transfers": { "requested": true } } } } } }
    ```
    ([marketplace quickstart](https://docs.stripe.com/connect/marketplace/quickstart), [marketplace guide](https://docs.stripe.com/connect/marketplace))
  - The `recipient` configuration "includes the `stripe_balance.stripe_transfers` (replacing v1 `transfers`) capability, which is required to use indirect charges" ([accounts-v2](https://docs.stripe.com/connect/accounts-v2)).
  - `dashboard` must be set when requesting `stripe_transfers`. "If you use destination charges … we recommend that you set both `losses_collector` and `fees_collector` to `application`." ([configuration](https://docs.stripe.com/connect/accounts-v2/connected-account-configuration))
  - The v1 equivalent of Express: `controller[stripe_dashboard][type]=express`, `controller[fees][payer]=application`, `controller[losses][payments]=application`, with `requirement_collection` left at `stripe`. Add `capabilities[transfers][requested]=true`. ([migrate](https://docs.stripe.com/connect/migrate-to-controller-properties), [express](https://docs.stripe.com/connect/express-accounts))
  - **Standard is not suitable:** its supported charge type is direct only, and the connected account carries dispute liability. ([account types](https://docs.stripe.com/connect/accounts))
  - Accounts v2 limitations: payout *settings* can't be managed with v2 ("Use the Accounts v1 API"), and the "recipient service agreement" needs v1. ([destination charges](https://docs.stripe.com/connect/destination-charges.md?platform=web&ui=elements), [accounts-v2](https://docs.stripe.com/connect/accounts-v2))
- **Onboarding (hosted).**
  - v2: `accountLinks.create({ account, use_case: { type: 'account_onboarding', account_onboarding: { refresh_url, return_url } } })`. On endive, **omit `configurations`** (the quickstart sample still shows it; the changelog says it errors).
  - v1: `POST /v1/account_links` with `account`, `refresh_url`, `return_url`, `type=account_onboarding`.
  - Links are single-use and expire after "a few minutes". Return to `refresh_url` to mint a new one. Reaching `return_url` "doesn't mean that all information has been collected". Check the account (`details_submitted`, capabilities) via API or `account.updated`.
  - Don't email or text account link URLs; give them only to the authenticated account holder inside the app.
  - ([express accounts](https://docs.stripe.com/connect/express-accounts), [quickstart](https://docs.stripe.com/connect/marketplace/quickstart), [endive change](https://docs.stripe.com/changelog/endive/2026-09-30/removes-configurations-parameter-from-v2-core-account-links-api))
- **Charge type: SCT vs destination charges.**
  - Destination charges: `transfer_data[destination]` + `application_fee_amount`. "The full charge amount is immediately transferred … after the charge is captured. The `application_fee_amount` … is then transferred back to the platform." One destination per charge. ([destination charges](https://docs.stripe.com/connect/destination-charges.md?platform=web&ui=elements))
  - SCT: "Create separate charges and transfers to transfer funds from one payment to multiple connected accounts, or when a specific user isn't known at the time of the payment." "Transfer and charge amounts don't have to match. You can split a single charge between multiple transfers or include multiple charges in a single transfer." ([SCT](https://docs.stripe.com/connect/separate-charges-and-transfers.md?platform=web&integration=custom&ui=elements&api-integration=paymentintents))
  - For both types: the platform balance is debited for Stripe fees, refunds and chargebacks; dispute amounts and fees hit the platform; with no `on_behalf_of` the platform is the business of record. ([SCT](https://docs.stripe.com/connect/separate-charges-and-transfers.md?platform=web&integration=custom&ui=elements&api-integration=paymentintents), [Connect disputes](https://docs.stripe.com/connect/disputes))
  - **SCT fits the existing ledger. Keep it.** Reasons:
    1. The tasker's share can exceed the card amount when points, promo or wallet fund part of the booking. Destination-charge transfers are capped at the charge.
    2. One booking has up to 3 charges (main, extras, tip) and a cancellation fee path.
    3. `planPayout` already implements hold days, dispute blocking and netting of clawbacks or negative balances. The SCT docs explicitly allow recovering refunds "by reducing subsequent transfer amounts or by reversing transfers".
    4. `payout` postings (Dr `tasker_payable` / Cr `payouts_clearing`) map 1:1 to a Transfer.
    5. Destination charges would push money at capture, before the 3-day hold and before disputes settle.
  - `on_behalf_of` isn't usable with recipient-only accounts: "Accounts under the recipient service agreement can't request `card_payments`" ([SCT](https://docs.stripe.com/connect/separate-charges-and-transfers.md?platform=web&integration=custom&ui=elements&api-integration=paymentintents)). That is fine, because TaskNest is the merchant of record.
  - Region: cross-border SCT transfers are supported only between US, CA, UK, EEA and CH; otherwise both accounts must be in the same region. That is fine for a US-only launch.

### 2.6 Transfers and payouts

- `POST /v1/transfers` with `amount`, `currency`, `destination`, `transfer_group`. "The `transfer_group` only identifies associated objects… To prevent a transfer from executing before the funds from the associated charge are available, use the transfer's `source_transaction` attribute." ([SCT](https://docs.stripe.com/connect/separate-charges-and-transfers.md?platform=web&integration=custom&ui=elements&api-integration=paymentintents))
- "Attempting a transfer that exceeds the available balance fails with an error." With `source_transaction=ch_…` the transfer succeeds immediately and becomes available when the charge's funds do. Multiple transfers may share one `source_transaction` up to the charge amount. It "must [be specified] when you create a transfer. You can't update that attribute later." Failed transfers aren't retried automatically. "Automatic payouts can interfere with transfers that don't have a defined `source_transaction`." (same page)
- Bank payouts *from* the connected account: "By default, any charge … accumulates in the connected account's balance and is paid out on a daily rolling basis."
  - Payout statuses: `pending`, `in_transit`, `paid`, `failed`, `canceled`.
  - Events: `payout.created`, `payout.updated`, `payout.paid`, `payout.failed`. "Regardless of the Accounts API version … payouts trigger only the v1 events." A failed payout disables the external account.
  - ([connected account payouts](https://docs.stripe.com/connect/payouts-connected-accounts))
- Test mode: use `4000000000000077` / `pm_card_bypassPending` so charges land in the *available* balance; otherwise transfers without `source_transaction` fail in tests. ([testing](https://docs.stripe.com/testing))

### 2.7 Refunds

- `POST /v1/refunds` with `payment_intent` (or `charge`) + `amount` for a partial refund. Several refunds are allowed but never more than the charge in total. "Stripe's processing fees from the original transaction aren't returned."
- Refunds draw on the *available* balance. If it's short, card refunds are held `pending`.
- Statuses include `pending`, `succeeded`, `failed`, `canceled`, `requires_action`. A refund can fail later (up to 30 days), which fires `refund.failed`; also listen for `refund.created`, `refund.updated` and `charge.refunded`.
- Platform refunds on SCT or destination charges are debited from the platform; "Reverse the transfers … to recover."
- ([refunds](https://docs.stripe.com/refunds))
- Destination charges only: `reverse_transfer=true` pulls back a proportional share of the transfer; `refund_application_fee=true` returns the fee to the connected account, and "If you refund the application fee for a destination charge, you must also reverse the transfer." ([destination charges](https://docs.stripe.com/connect/destination-charges.md?platform=web&ui=elements))
- SCT: "refunding a charge has no impact on any associated transfers." Use `POST /v1/transfers/{id}/reversals` (full or `amount`), which works only if the connected account's available balance covers it, or net against the next transfer. ([SCT](https://docs.stripe.com/connect/separate-charges-and-transfers.md?platform=web&integration=custom&ui=elements&api-integration=paymentintents))
- Test: `4000000000005126` / `pm_card_refundFail` (status goes `succeeded`, then `failed`, then `refund.failed`); `4000000000007726` (`pending`, then `succeeded`). ([testing](https://docs.stripe.com/testing))

### 2.8 Disputes

- When a dispute opens, Stripe "Debits the disputed amount, plus a dispute fee, from your Stripe account". You can't refund outside the dispute process while it's open. The disputed amount "might be lower or higher than the amount of the original charge". ([how disputes work](https://docs.stripe.com/disputes/how-disputes-work))
- Fees (US): the dispute received fee is **15 USD**, and "never returned" outside Mexico. Countering adds a **15 USD** countered fee, which is returned if you win. ([support: fees](https://support.stripe.com/questions/june-2025-pricing-updates-for-disputes), [how disputes work](https://docs.stripe.com/disputes/how-disputes-work))
- Statuses:
  - inquiries: `warning_needs_response`, `warning_under_review`, `warning_closed` (closed after 120 days)
  - chargebacks: `needs_response`, `under_review`, `won`, `lost`
  - A rare `lost` → `won` "late win" can happen.
  - Events also include `charge.dispute.funds_reinstated` (listed under refund events). ([how disputes work](https://docs.stripe.com/disputes/how-disputes-work), [refunds](https://docs.stripe.com/refunds))
- Connect (indirect charges): the platform is debited. "If you challenge the dispute, wait for the dispute outcome before reversing the transfer… If you lose, reverse the transfer." ([Connect disputes](https://docs.stripe.com/connect/disputes))
- Test: `4000000000000259` (synchronous fraudulent dispute), `4000000000001976` (inquiry); evidence `winning_evidence` / `losing_evidence`. ([testing](https://docs.stripe.com/testing))

### 2.9 Webhooks

- Each endpoint has its own `whsec_` secret; test and live secrets differ. Verify the `Stripe-Signature` header (`t=`, `v1=`) by HMAC-SHA256 of `"{t}.{raw body}"`, ignoring non-`v1` schemes, with a constant-time compare. Library tolerance is 5 minutes ("Don't use a tolerance value of 0"). During a secret roll, multiple `v1` signatures are sent for up to 24 h. "Stripe requires the raw body of the request." ([webhooks](https://docs.stripe.com/webhooks))
- Delivery:
  - Live mode retries "for up to three days with an exponential back off". **Sandbox retries only "three times over the course of a few hours."**
  - Ordering is not guaranteed; don't use `created` for ordering.
  - Dedupe by event id; "In some cases, two separate Event objects are generated" for the same object and type.
  - "Quickly return a successful status code (2xx) before any complex logic."
  - Prefer an asynchronous queue.
  - ([webhooks](https://docs.stripe.com/webhooks))
- Thin events are now GA for v1 resources and recommended "for most integrations". Snapshot events are still supported. ([webhooks](https://docs.stripe.com/webhooks), [Endive changelog](https://docs.stripe.com/changelog/endive))
- **Connect scope:** you need a *second* destination with events from **Connected accounts** (`events_from=["@accounts"]`, or `connect=true` on v1 webhook endpoints).
  - It receives `account.updated` (v1, even for v2 Accounts), `payout.*`, `account.external_account.updated` and `person.updated`. v2 `v2.core.account.*` events arrive on the **Your account** scope.
  - "Your production webhook URLs receive both live and test webhooks… check the `livemode` value."
  - Each connected-account event carries a top-level `account`.
  - ([Connect webhooks](https://docs.stripe.com/connect/webhooks), [webhooks](https://docs.stripe.com/webhooks))
- **Events TaskNest should subscribe to:**
  - Your account:
    - `payment_intent.amount_capturable_updated`, `payment_intent.succeeded`, `payment_intent.payment_failed`, `payment_intent.canceled` (hold expired or voided), `payment_intent.requires_action`
    - `charge.refunded`, `refund.created`, `refund.updated`, `refund.failed`
    - `charge.dispute.created`, `.updated`, `.closed`, `.funds_withdrawn`, `.funds_reinstated`
    - `transfer.created`, `transfer.reversed`
    - `v2.core.account.*` (requirements and capability status)
  - Connected accounts: `account.updated`, `payout.created`, `payout.paid`, `payout.failed`, `account.external_account.updated`.
- **Supabase Edge Function specifics:**
  - Deploy with `verify_jwt = false`, which the repo already sets in `config.toml`.
  - Read the body with `await req.text()` before parsing.
  - The official Supabase example uses `import Stripe from 'npm:stripe@^22'`, `Stripe.createSubtleCryptoProvider()` and `stripe.webhooks.constructEventAsync(body, signature, secret, undefined, cryptoProvider)` ([Supabase example source](https://github.com/supabase/supabase/blob/master/examples/edge-functions/supabase/functions/stripe-webhooks/index.ts), linked from [Supabase docs](https://supabase.com/docs/guides/functions/examples/stripe-webhooks)).
  - The repo's own WebCrypto verifier is functionally equivalent and tested. Keep it, or swap in `constructEventAsync`.

### 2.10 Idempotency keys

- Send `Idempotency-Key` on all POSTs (up to 255 chars; V4 UUIDs suggested; no PII). For v1, Stripe "saves the status code and body of the first request … including 500 errors". Keys may be pruned "after they're at least 24 hours old", and a reused key after pruning "generate[s] a new request". Different parameters under the same key cause an error. Validation failures and concurrent-conflict responses are not saved and can be retried. ([idempotent requests](https://docs.stripe.com/api/idempotent_requests))

### 2.11 Test cards, sandboxes and test clocks

- Use `pm_card_*` ids in automated tests rather than card numbers ([testing](https://docs.stripe.com/testing)). Key ids:

  | Test id | Scenario |
  |---|---|
  | `pm_card_visa` | Success |
  | `pm_card_visa_chargeDeclined` | Generic decline |
  | `pm_card_visa_chargeDeclinedInsufficientFunds` | Insufficient funds |
  | `pm_card_threeDSecure2Required` | 3DS required |
  | `pm_card_authenticationRequired*` | Off-session authentication cases |
  | `pm_card_bypassPending` | Funds land in available balance |
  | `pm_card_createDispute*` | Disputes |
  | `pm_card_refundFail` | Refund fails asynchronously |
  | `pm_card_pendingRefund` | Refund pending, then succeeds |

  Note: the repo's fake decline id `pm_card_chargeDeclined` is not in Stripe's current table, which lists `pm_card_visa_chargeDeclined`.
- **Test clocks are Billing-only** (Customers, Subscriptions, Invoices; "simulate Billing objects, such as subscriptions … over time"). They do not advance PaymentIntent authorization expiry or Connect balances. ([billing testing / test clocks](https://docs.stripe.com/billing/testing/test-clocks)) The testing page documents no test helper for authorization expiry. Keep time-travel tests on the fake provider, and assert on `capture_before` in Stripe test mode.
- Use separate sandboxes for local development and CI (recommended in [billing testing](https://docs.stripe.com/billing/testing/test-clocks)).

### 2.12 Live-key refusal

- Sandbox keys: `pk_test_`, `rk_test_`, `sk_test_`. Live keys: `pk_live_`, `rk_live_`, `sk_live_`. Webhook secrets are separate and per endpoint. Stripe recommends **restricted keys (`rk_`)** over secret keys, and access policies on live keys. ([API keys](https://docs.stripe.com/keys))
- Defence in depth for a test-only product:
  1. Refuse `sk_live_` and `rk_live_` on the server (already done).
  2. Refuse `pk_live_` in the Vite build (new).
  3. Reject any webhook event with `livemode: true` (new).
  4. Assert `livemode === false` on PaymentIntent, Transfer and Refund responses (new).

### 2.13 Minimum amounts

- Minimum USD charge: **0.50 USD**. Charges below the minimum fail. ([currencies](https://docs.stripe.com/currencies))

---

## 3. Gap list (repo vs docs)

Severity scale: **P0** breaks or causes wrong money movement against real Stripe; **P1** correctness or reconciliation risk; **P2** hardening and documentation.

| # | Sev | Where | Gap / incorrect usage | Fix (doc) |
|---|---|---|---|---|
| 1 | P0 | `src/` (none), `bookings.ts` request body `paymentMethod` | No Stripe.js or Payment Element. The client can't produce a real PaymentMethod or ConfirmationToken, and there is no 3DS path. | Add React Stripe.js with the deferred-intent and ConfirmationToken flow; handle `requires_action` with `handleNextAction` (§2.2). |
| 2 | P0 | `stripe.ts:80,117` | Silent fallback to `pm_card_visa` when no payment method is sent. In Stripe mode every booking and tip "succeeds" on a test card regardless of the user. | Require a ConfirmationToken or saved PaymentMethod and drop the fallback. Keep `pm_card_*` only in tests (§2.11). |
| 3 | P0 | `bookings.ts:739-761` | Re-auth and extras call `charge()` with no `customer`, no `payment_method` and no `off_session`, so they don't charge the client's card. | Save the card at booking (`customer` + `setup_future_usage=off_session`); charge extras off-session; handle `authentication_required` (§2.4). |
| 4 | P0 | `stripe.ts:81,118` + `stripe.ts:55` | Sends `payment_method_types[]=card`, which is removed in `2026-09-30.endive` (400 `payment_method_types_no_longer_supported`). The pinned version `2024-06-20` predates the acacia process. | Pin `2026-10-28.endive`; replace with `allowed_payment_method_types[]=card` or dynamic payment methods (§2.1). |
| 5 | P0 | `admin.ts:109-136`, seed `acct_fake_*` | No connected-account creation or onboarding. `stripe_account_id` is set by hand, with no capability or requirements check before transferring. | Accounts v2 recipient account + v2 Account Link (no `configurations`); gate payouts on `stripe_transfers` status (§2.5). |
| 6 | P0 | `stripe.ts:143-155`, `admin.ts:122` | Transfers have no `source_transaction` and no `transfer_group`, so they draw on the platform *available* balance and fail when it's short (always, in test mode, without `bypassPending`). | Per-booking transfers with `transfer_group=booking:<id>` and `source_transaction=<ch_ of main PI>` (split when the tasker share exceeds that charge), or fund the balance (§2.6). |
| 7 | P0 | `stripe.ts:88-89` | A `requires_action` (3DS) result throws `authorization_failed` and leaves the PaymentIntent un-canceled. With `confirm=true` and no `return_url`, a redirect method can't complete. | Return `client_secret` for `handleNextAction`; cancel abandoned PaymentIntents; restrict to cards with `allowed_payment_method_types` (§2.2). |
| 8 | P1 | `bookings.ts:254`, `domain/config.ts:88` | `auth_expires_at` = now + 7 days from policy. That is wrong for Visa MIT (4 d 18 h) and for off-session re-holds, and ignores `capture_before`. | Store `latest_charge.payment_method_details.card.capture_before` (expand `latest_charge`) (§2.3). |
| 9 | P1 | `bookings.ts:244-254` | A booking with start more than 7 days out gets a hold that expires before the task. `needsReauth` is only reported; nothing re-holds. The expired PaymentIntent becomes `canceled`, and no event is handled. | Save card at booking; a scheduled job re-holds off-session before start (MIT window); handle `payment_intent.canceled` (§2.3, §2.9). |
| 10 | P1 | `_shared/stripe-webhook.ts:15,113` | Only `charge.dispute.*` is handled. Missing `payment_intent.*`, `refund.*`/`charge.refunded`, `charge.dispute.funds_*`, `transfer.reversed`, `account.updated`/v2 account events, `payout.*`. | Subscribe and handle (§2.9). |
| 11 | P1 | `stripe-webhook.ts:134-157` | No `livemode` check. Connect production endpoints receive live *and* test events. | Reject or ignore `livemode: true` (§2.9, §2.12). |
| 12 | P1 | `stripe-webhook/index.ts`, BACKEND_NOTES step 3 | There is a single endpoint and a single `STRIPE_WEBHOOK_SECRET`. Connect-scope events (`account.updated`, `payout.*`) need a second destination with its own secret. | Add a Connect destination and `STRIPE_CONNECT_WEBHOOK_SECRET`; verify against either secret (§2.9). |
| 13 | P1 | BACKEND_NOTES "Switching…" step 3 | The webhook endpoint is created with no pinned API version, so payloads follow the account default. | Create the endpoint with `2026-10-28.endive` (§2.1). |
| 14 | P1 | `disputes.ts:19,73-119`, `postings.ts` `disputeLostTxn` | The $15 fee is booked only on *loss*. Stripe debits the amount **and** a non-refundable $15 at *creation*; countering adds $15, returned on a win; funds return on a win. The ledger can't reconcile to Stripe balance transactions. | Post `dispute_opened` (reverse amount + $15 received fee), `dispute_countered` (+$15), `dispute_won` (reinstate amount + countered fee). Keep the tasker clawback only on loss (§2.8). |
| 15 | P1 | `stripe-webhook.ts:81-87` | Ignores inquiry statuses (`warning_*`), `needs_response` updates and `warning_closed`. The dispute amount is taken as is, which is fine, but the docs note it can exceed the charge. | Map all statuses; treat `warning_closed` as closed with no loss (§2.8). |
| 16 | P1 | `stripe-webhook.ts:21-29` | A dispute on a **tip** PaymentIntent (`tips.stripe_payment_intent_id`) or an old pre-reauth PaymentIntent finds no booking, is recorded as handled:false, and is never retried. | Look up all PaymentIntent columns (tips, history), or store PaymentIntent → booking in a mapping table. |
| 17 | P1 | `money.ts:292-314` | Refunds are recorded as final on the API response. Async `refund.failed` and `pending` refunds (insufficient balance) aren't tracked, so the ledger shows money returned that wasn't. | Store `re_` id + status; handle `refund.updated`/`refund.failed` with a reversing ledger txn (§2.7). |
| 18 | P1 | `admin.ts:135` | The `payouts.status = 'paid'` row means "transfer created". The real bank payout (daily rolling on the connected account) can still fail (`payout.failed` disables the external account). | Rename to transfers; track connected-account payouts separately via `payout.*` (§2.6). |
| 19 | P1 | Ledger (`domain/ledger.ts`, BACKEND_NOTES ledger table) | No Stripe processing-fee or Connect-fee accounts. With SCT the platform pays all Stripe fees, and refunds don't return them, so `card_clearing` will never match the Stripe balance. | Add `stripe_fees` expense, posted from `balance_transaction.fee` on capture, refund and dispute (§2.5, §2.7). |
| 20 | P1 | `domain/tender.ts`, `tips.ts` | No 50-cent minimum on the card tender, tips or extras. Stripe rejects charges under 0.50 USD. | Enforce `card ≥ 50` or `card == 0` in allocation and tip validation (§2.13). |
| 21 | P1 | `stripe.ts:60-67` | Error mapping is too coarse: every non-402 becomes 502 (retryable). That includes 400 `invalid_request_error` such as `payment_intent_unexpected_state` and `amount_too_small`, and 409 `idempotency_error`, so retries loop. `fetch` network errors and non-JSON bodies aren't handled. | Map 400 to 4xx (final), 409 idempotency to 409, 429 and 5xx or network errors to retryable; keep 402 card errors (§2.10). |
| 22 | P1 | Keys like `${b.id}:reauth`, `${b.id}:capture`, `${b.id}:extras` | Stripe prunes keys after ≥24 h. A retry after a long outage of `reauth` or `extras` would create a **second charge**. | Persist the provider object id before or after each call (look up by `metadata.booking_id` + kind, or store the `pi_` before the commit); never rely on keys older than 24 h (§2.10). |
| 23 | P1 | `bookings.ts:321,464,568` | `cancel(...).catch(() => {})` hides failed voids, leaving funds held on the customer's card for up to 7 days. | Log, queue and retry; reconcile against `payment_intent.canceled` (§2.3). |
| 24 | P2 | `money.ts:57-64` | Tips: an on-session raw payment method with no customer. | Charge the saved card on-session (or off-session with consent); refunds of tips are unsupported. |
| 25 | P2 | `stripe-webhook.ts:134-157` | Processing runs inline under leases (up to 5 s then 409). Docs say return 2xx quickly; sandbox retries only 3 times in a few hours. | Persist the event and ack 200; process from a queue or cron (§2.9). |
| 26 | P2 | `stripe-webhook.ts:113` | Unhandled events are inserted into `stripe_events` and marked seen, so adding a handler later can't replay them from the endpoint. | Store the raw payload, or skip the `stripe_events` insert for unsubscribed types. |
| 27 | P2 | `provider/index.ts`, Vite env | No `pk_live_` guard (there is no publishable key yet), and no `livemode` assertion on API responses. | Add `VITE_STRIPE_PUBLISHABLE_KEY` with a `pk_test_` check in build and CI; assert `livemode === false` (§2.12). |
| 28 | P2 | `stripe.ts:20-33` | `formEncode` supports one nesting level, but `payment_method_options[card][capture_method]` and `expand[]` need deeper nesting, and v2 endpoints need JSON. | Use `npm:stripe@23.1.0` in Deno (with `createSubtleCryptoProvider` for webhooks), or extend the encoder (§2.9). |
| 29 | P2 | `api/index.ts:287` | Duplicate `/webhooks/stripe` route behind JWT. It's harmless, but two code paths exist. | Remove it, or document that it is test-only. |
| 30 | P2 | BACKEND_NOTES "Payments providers" | Docs describe Connect "test accounts" set by hand; there is no mention of sandboxes, restricted keys, or test cards for available balance and disputes. | Update the runbook using §2.11–2.12. |
| 31 | P2 | `fake.ts:304` | `FAKE_DECLINE_PM = "pm_card_chargeDeclined"` doesn't match Stripe's `pm_card_visa_chargeDeclined`, so the same test input behaves differently by provider. | Align the ids ([testing](https://docs.stripe.com/testing)). |

**What is already correct:**

- Raw-body HMAC verification with a 5-minute tolerance, a constant-time compare and multiple `v1` support.
- Event-id dedupe inside the same database transaction.
- `capture_method=manual` + `amount_to_capture` partial capture, which releases the remainder.
- Cancel for uncaptured holds.
- `Idempotency-Key` on every POST.
- Live-key refusal on the server and in CI, with `rk_test_` accepted.
- `verify_jwt=false` on the webhook function.
- Refunds blocked while a dispute is open.

---

## 4. Target flows for TaskNest (SCT)

1. **Client onboarding.** On first checkout, create a Stripe Customer (or a v2 Account with the `customer` configuration) and store `profiles.stripe_customer_id`. Create a CustomerSession so saved cards render in the Payment Element.
2. **Book.**
   - The server quotes and allocates tenders (unchanged), giving `card = alloc.parts.card` (≥ 50 or 0).
   - The client mounts Elements `{mode:'payment', amount: card, currency:'usd', captureMethod:'manual', setupFutureUsage:'off_session'}`. If start is more than about 4 days away, or `card == 0`, it mounts `mode:'setup'` instead.
   - The client calls `createConfirmationToken` and sends `POST /bookings {…, confirmationTokenId}`.
   - The server creates the PaymentIntent with:
     - `amount`, `currency=usd`, `capture_method=manual`, `confirm=true`
     - `confirmation_token`, `customer`, `setup_future_usage=off_session`
     - `allowed_payment_method_types[]=card`
     - `transfer_group=booking:<id>`, `metadata[booking_id]`, `expand[]=latest_charge`
     - `Stripe-Version: 2026-10-28.endive`, Idempotency-Key
   - Outcomes:
     - `requires_action`: return `client_secret`; the client calls `handleNextAction` and then confirms.
     - `requires_capture`: store `pi_`, `ch_`, `payment_method`, `capture_before`.
     - Otherwise: cancel, release points, return 402.
3. **Pre-start re-hold (job).** If there is no live hold, or `capture_before` falls before the expected completion:
   - Create a new manual-capture PaymentIntent with `off_session=true`, `confirm=true`, `customer`, `payment_method`.
   - On `authentication_required`, mark the booking `payment_action_required` and notify the client to authenticate on-session.
   - Cancel the old PaymentIntent.
4. **Complete.**
   - Capture `amount_to_capture = paid.card` once.
   - Extras: an off-session automatic-capture PaymentIntent on the saved card (same `transfer_group`, `metadata[kind]=extras`), with `authentication_required` handled as above.
   - Post `booking_completed` and `extras_charged` as today.
   - Post a Stripe fee line from each `balance_transaction`.
5. **Tip.** On-session with the saved card (`customer` + `payment_method`, `confirm=true`) or the Payment Element. Same `transfer_group`. 100% to `tasker_payable`.
6. **Payout run (cron).** `planPayout` is unchanged. For each eligible booking:
   - `POST /v1/transfers` with `destination=acct_…`, `transfer_group=booking:<id>`, `source_transaction=<ch_>` (amount ≤ charge; any remainder funded by points or promo is transferred without a source transaction from the funded platform balance), `metadata[payout_id]`.
   - Gate on the recipient `stripe_transfers` capability being active.
   - Negative balances keep netting as today, or use `POST /v1/transfers/{tr}/reversals` when the connected account's available balance allows.
7. **Refund.** `POST /v1/refunds {payment_intent, amount}` per charge, across main, extras and tip. Store `re_` + status. Recover the tasker share by netting, or reverse the transfer if already transferred.
8. **Dispute.**
   - `created`: reverse amount + $15 fee, block refunds and payouts.
   - `funds_withdrawn` / `funds_reinstated`: mirror Stripe's balance movements.
   - `closed` won: reinstate the amount and the countered fee.
   - `closed` lost: run the tasker clawback (transfer reversal or netting) and points clawback.
9. **Webhooks.** Two event destinations (your account and connected accounts) on the pinned version. Verify, check `livemode === false`, store the event, ack 200, and process asynchronously and idempotently by event id plus object id and type.

## 5. Schema and environment additions

- **`profiles`:** `stripe_customer_id`, `default_payment_method_id`.
- **`bookings`:**
  - `stripe_charge_id`
  - `capture_before` (replaces the computed `auth_expires_at`)
  - `payment_state` (`requires_action` | `hold_active` | `hold_expired` | `captured`)
  - `setup_intent_id`
- **`taskers`:**
  - `stripe_account_id` (real `acct_`)
  - `stripe_transfers_status`
  - `requirements_due` (jsonb)
  - `onboarding_completed_at`
- **`tips`:** `stripe_charge_id`.
- **`refunds`:** `stripe_refund_ids` with status.
- **`transfers` (rename of `payouts`):**
  - `stripe_transfer_id`
  - `source_transaction`
  - `transfer_group`
  - `reversed_cents`
- **`connected_payouts`:** `po_`, status, `failure_code`.
- **`stripe_events`:** `payload` (jsonb), `livemode`, `api_version`, `account`, `processed_at`.
- **Environment:**
  - `STRIPE_SECRET_KEY` (prefer `rk_test_`)
  - `STRIPE_API_VERSION=2026-10-28.endive`
  - `STRIPE_WEBHOOK_SECRET`
  - `STRIPE_CONNECT_WEBHOOK_SECRET`
  - `VITE_STRIPE_PUBLISHABLE_KEY` (`pk_test_` only, enforced in `check-live-keys.sh`)

## 6. Test matrix (Stripe sandbox; ids from [testing](https://docs.stripe.com/testing))

| Scenario | Input | Expect |
|---|---|---|
| Happy hold, capture, transfer | `pm_card_bypassPending` | `requires_capture`, then `succeeded`; transfer with `source_transaction` succeeds |
| Decline at booking | `pm_card_visa_chargeDeclined` | 402, no booking row, points released |
| 3DS at booking | `pm_card_threeDSecure2Required` / `4000000000003220` | `requires_action`, then `handleNextAction`, then `requires_capture` |
| Off-session extras OK after setup | `4000002500003155` | Setup needs authentication; extras succeed off-session |
| Off-session extras need authentication | `pm_card_authenticationRequired` / `4000002760003184` | `authentication_required`; booking flagged; on-session recovery |
| Refund fails asynchronously | `pm_card_refundFail` | `refund.failed`, then the ledger reversal posts |
| Dispute lost or won | `4000000000000259` + `losing_evidence` / `winning_evidence` | `created` posts amount + $15; outcome posts match Stripe balance |
| Amount below minimum | card tender 49¢ | Rejected by domain before Stripe |
| Live key | `sk_live_…`, `pk_live_…`, event `livemode:true` | Refused / 503 / ignored |

Time-based cases (48 h cancellation tiers, authorization expiry) stay on the fake provider. Stripe test clocks don't apply to PaymentIntents ([test clocks](https://docs.stripe.com/billing/testing/test-clocks)).

## 7. Priority order

1. Pin `2026-10-28.endive`; replace `payment_method_types` (#4).
2. Customers + Payment Element + ConfirmationToken + `handleNextAction` (#1, #2, #7).
3. Saved card + off-session extras and re-hold + `capture_before` (#3, #8, #9).
4. Webhooks: events, `livemode`, Connect endpoint, refund and PaymentIntent handlers (#10–#13, #17).
5. Connect: v2 recipient accounts, Account Links, capability gating, `source_transaction` transfers (#5, #6, #18).
6. Ledger: Stripe fees, dispute timing and fees, 50¢ minimum (#14, #15, #19, #20).
7. Hardening (#21–#31).

## 8. UX notes (patterns only; TaskNest keeps its own brand)

- Show "We'll place a temporary hold of $X on your card; you're charged after the task is done" at checkout, plus a consent checkbox for saving the card for extras ([save during payment compliance](https://docs.stripe.com/payments/save-during-payment.md?payment-ui=elements)). TaskRabbit shows its one-hour deposit during booking ([TaskRabbit help](https://support.taskrabbit.com/hc/en-us/articles/46260462243611-Why-Was-I-Charged-Right-After-Booking)); copy only the pattern of disclosing it up front.
- Booking states to surface:
  - "Payment needs your approval" (`authentication_required`)
  - "Hold expired: re-confirm card"
  - "Refund pending" / "Refund failed"
  - Tasker side: "Finish payout setup" (Account Link) and "Payout failed: update bank" (`payout.failed`)

## 9. Sources (fetched 2026-10-29)

- https://docs.stripe.com/api/versioning
- https://docs.stripe.com/changelog/endive
- https://docs.stripe.com/changelog/endive/2026-09-30/removes-the-payment-method-types-parameter-from-payment-intents-and-setup-intents
- https://docs.stripe.com/changelog/endive/2026-09-30/removes-configurations-parameter-from-v2-core-account-links-api
- https://docs.stripe.com/api/idempotent_requests
- https://docs.stripe.com/payments/place-a-hold-on-a-payment-method
- https://docs.stripe.com/payments/extended-authorization.md?platform=web&ui=elements
- https://docs.stripe.com/payments/paymentintents/lifecycle
- https://docs.stripe.com/payments/finalize-payments-on-the-server.md?platform=web&type=payment
- https://docs.stripe.com/payments/save-during-payment.md?payment-ui=elements
- https://docs.stripe.com/payments/save-and-reuse.md?payment-ui=elements
- https://docs.stripe.com/connect/accounts
- https://docs.stripe.com/connect/accounts-v2
- https://docs.stripe.com/connect/accounts-v2/connected-account-configuration
- https://docs.stripe.com/connect/migrate-to-controller-properties
- https://docs.stripe.com/connect/express-accounts
- https://docs.stripe.com/connect/marketplace
- https://docs.stripe.com/connect/marketplace/quickstart
- https://docs.stripe.com/connect/separate-charges-and-transfers.md?platform=web&integration=custom&ui=elements&api-integration=paymentintents
- https://docs.stripe.com/connect/destination-charges.md?platform=web&ui=elements
- https://docs.stripe.com/connect/payouts-connected-accounts
- https://docs.stripe.com/connect/disputes
- https://docs.stripe.com/connect/webhooks
- https://docs.stripe.com/refunds
- https://docs.stripe.com/disputes/how-disputes-work
- https://support.stripe.com/questions/june-2025-pricing-updates-for-disputes
- https://docs.stripe.com/webhooks
- https://docs.stripe.com/testing
- https://docs.stripe.com/billing/testing/test-clocks
- https://docs.stripe.com/keys
- https://docs.stripe.com/currencies
- https://supabase.com/docs/guides/functions/examples/stripe-webhooks and https://github.com/supabase/supabase/blob/master/examples/edge-functions/supabase/functions/stripe-webhooks/index.ts
- https://support.taskrabbit.com/hc/en-us/articles/46260462243611-Why-Was-I-Charged-Right-After-Booking
