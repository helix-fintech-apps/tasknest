// Deterministic fake provider for CI / local dev / the demo project. It never moves money.
// Composes the payments (WS4) and Connect (WS5) method groups. State (what was authorized, captured or
// refunded) lives in the database rows the API writes.

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
import { FakeConnect } from "./connect.ts";
import { FakePayments } from "./payments.ts";

export { FAKE_DECLINE_PM } from "./scenarios.ts";

export class FakeProvider implements PaymentsProvider {
  readonly name = "fake" as const;
  private payments: FakePayments;
  private connect: FakeConnect;

  constructor() {
    this.payments = new FakePayments();
    this.connect = new FakeConnect();
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
