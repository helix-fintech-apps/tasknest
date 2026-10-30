// Stripe (test mode) provider: composes the payments (WS4) and Connect (WS5) method groups over one
// authenticated transport (http.ts).

import type {
  AccountStatus,
  AuthorizeInput,
  ChargeInput,
  ConnectComponent,
  IntentResult,
  Method,
  PaymentInput,
  PaymentIntentResult,
  PaymentsProvider,
  SetupResult,
  TransferInput,
} from "../types.ts";
import { StripeConnect } from "./connect.ts";
import { StripeHttp } from "./http.ts";
import { StripePayments } from "./payments.ts";

export { formEncode, hmacSha256Hex, verifyStripeSignature } from "./http.ts";

export class StripeProvider implements PaymentsProvider {
  readonly name = "stripe" as const;
  private payments: StripePayments;
  private connect: StripeConnect;

  constructor(secretKey: string) {
    const http = new StripeHttp(secretKey); // refuses live keys
    this.payments = new StripePayments(http);
    this.connect = new StripeConnect(http);
  }

  // ---- Deprecated wrappers ----
  authorize(i: AuthorizeInput): Promise<PaymentIntentResult> {
    return this.payments.authorize(i);
  }
  capture(piId: string, amountCents: number, key: string): Promise<PaymentIntentResult> {
    return this.payments.capture(piId, amountCents, key);
  }
  cancel(piId: string, key: string): Promise<void> {
    return this.payments.cancel(piId, key);
  }
  charge(i: ChargeInput): Promise<PaymentIntentResult> {
    return this.payments.charge(i);
  }
  refund(piId: string, amountCents: number, key: string): Promise<{ id: string }> {
    return this.payments.refund(piId, amountCents, key);
  }
  transfer(i: TransferInput): Promise<{ id: string }> {
    return this.connect.transfer(i);
  }

  // ---- Payments (WS4) ----
  ensureCustomer(userId: string, email: string): Promise<{ customerId: string }> {
    return this.payments.ensureCustomer(userId, email);
  }
  customerSession(customerId: string): Promise<{ clientSecret: string } | { simulated: true }> {
    return this.payments.customerSession(customerId);
  }
  holdOnSession(i: Parameters<PaymentsProvider["holdOnSession"]>[0]): Promise<IntentResult> {
    return this.payments.holdOnSession(i);
  }
  setupOnSession(i: {
    customerId: string;
    payment: PaymentInput;
    idempotencyKey: string;
  }): Promise<SetupResult> {
    return this.payments.setupOnSession(i);
  }
  holdOffSession(i: Parameters<PaymentsProvider["holdOffSession"]>[0]): Promise<IntentResult> {
    return this.payments.holdOffSession(i);
  }
  chargeOffSession(i: Parameters<PaymentsProvider["chargeOffSession"]>[0]): Promise<IntentResult> {
    return this.payments.chargeOffSession(i);
  }
  chargeOnSession(i: Parameters<PaymentsProvider["chargeOnSession"]>[0]): Promise<IntentResult> {
    return this.payments.chargeOnSession(i);
  }
  retrieveIntent(id: string): Promise<IntentResult> {
    return this.payments.retrieveIntent(id);
  }
  listMethods(customerId: string): Promise<Method[]> {
    return this.payments.listMethods(customerId);
  }
  detachMethod(pmId: string): Promise<void> {
    return this.payments.detachMethod(pmId);
  }

  // ---- Connect (WS5) ----
  createConnectedAccount(
    i: Parameters<PaymentsProvider["createConnectedAccount"]>[0],
  ): Promise<{ accountId: string }> {
    return this.connect.createConnectedAccount(i);
  }
  accountSession(
    accountId: string,
    components: ConnectComponent[],
  ): Promise<{ clientSecret: string }> {
    return this.connect.accountSession(accountId, components);
  }
  accountLink(accountId: string, refreshUrl: string, returnUrl: string): Promise<{ url: string }> {
    return this.connect.accountLink(accountId, refreshUrl, returnUrl);
  }
  retrieveAccount(accountId: string): Promise<AccountStatus> {
    return this.connect.retrieveAccount(accountId);
  }
  reverseTransfer(transferId: string, amountCents: number, key: string): Promise<{ id: string }> {
    return this.connect.reverseTransfer(transferId, amountCents, key);
  }
}
