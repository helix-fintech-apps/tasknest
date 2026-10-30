-- Money policy v2 (plan 7.1). v1 is untouched: a booking keeps the policy version it was created under.
--
-- v2 = v1 plus: a card minimum of 50 cents (Stripe's USD minimum charge), a 50-cent minimum tip and extras
-- charge, the hold-timing rules (hold now within 96 hours of the start, otherwise save the card and hold 48
-- hours before; re-hold when the hold would expire within 24 hours of the end), and the card-consent text
-- version. Mirrors POLICY_V2 in supabase/functions/_shared/domain/config.ts; tests/unit/policy-v2.test.ts
-- fails if the two drift apart.
--
-- effective_from is the moment the migration runs, so bookings made before it stay on v1.

insert into money_policies (version, policy, effective_from)
values (2, '{"version":2,"currency":"USD","clientServiceFeeBps":1500,"taskerCommissionBps":1500,"taxBps":0,"cancellation":{"tiers":[{"minHoursBefore":48,"refundBps":10000},{"minHoursBefore":24,"refundBps":5000},{"minHoursBefore":0,"refundBps":0,"chargeMinutesOfRate":60}],"noShowRefundBps":0,"serviceFeeRefundable":true},"taskerPenalty":{"cancelFeeCents":1000,"strikesToSuspend":3,"strikeWindowDays":30},"tips":{"capBpsOfSubtotal":2500,"windowDays":30,"platformFeeBps":0,"allowedTenders":["card"],"minCents":50},"points":{"centsPerPoint":1,"pointsPerDollarCash":1,"minRedeemPoints":500,"maxRedeemBpsOfTotal":10000,"pendingDays":7,"expiryMonths":12,"reissueDaysOnExpiredRefund":30,"reviewBonusPoints":100},"tenderUseOrder":["promo","points","wallet","card"],"refundOrder":["card","wallet","points","promo"],"retentionOrder":["card","wallet","points","promo"],"payouts":{"holdDays":3},"refunds":{"agentLimitCents":10000,"windowDays":30,"providerShare":"proportional"},"auth":{"validityDays":7,"reauthBufferDays":1,"holdNowMaxHoursBeforeStart":96,"scheduledHoldLeadHours":48,"captureBufferHours":24},"booking":{"taskerResponseHours":24},"card":{"minChargeCents":50},"extras":{"minCardChargeCents":50},"consent":{"textVersion":"card-consent-v1"}}'::jsonb, now())
on conflict (version) do nothing;
