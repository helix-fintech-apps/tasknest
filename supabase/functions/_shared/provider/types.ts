// Payments provider interface. Amounts are integer cents (USD).
//
// Frozen contract: docs/contracts.md section 4.4. Wave 0 (WS7-a) defines the whole interface; WS4 implements
// the payments methods (stripe/payments.ts, fake/payments.ts) and WS5 the Connect methods
// (stripe/connect.ts, fake/connect.ts). Until then the new methods throw `not_implemented` (501).

// ---- Legacy inputs (deprecated wrappers; deleted in Wave 2 once handlers use the new methods) ------

export interface AuthorizeInput {
  amountCents: number;
  bookingId: string;
  description: string;
  paymentMethod?: string; // e.g. "pm_card_visa"; fake provider: "pm_card_chargeDeclined" simulates a decline
  idempotencyKey: string;
}

export interface ChargeInput {
  amountCents: number;
  bookingId: string;
  description: string;
  paymentMethod?: string;
  idempotencyKey: string;
  kind: "extras" | "tip" | "reauth";
}

export interface TransferInput {
  amountCents: number;
  destination: string; // Stripe Connect account id (acct_...)
  payoutId: string;
  idempotencyKey: string;
  /** Per-booking transfers (WS5, plan 7.3). Optional until the payout handler moves over. */
  transferGroup?: string;
  /** `ch_` of the charge that funds the transfer (Stripe `source_transaction`). */
  sourceTransaction?: string;
  bookingId?: string;
}

export interface PaymentIntentResult {
  id: string;
  status: string;
  amountCents: number;
}

// ---- New contract (plan 4.4) ----------------------------------------------------------------------

/** Opaque token from the SimulatedCardForm (fake provider only). The card number never leaves the browser. */
export type SimToken = string;

export type PaymentInput =
  | { kind: "confirmation_token"; id: string } // ctoken_... from stripe.createConfirmationToken
  | { kind: "saved_method"; paymentMethodId: string } // pm_... on the customer
  | { kind: "simulated"; token: SimToken }; // fake provider only

/** The slice of a Stripe BalanceTransaction that TaskNest stores (`stripe_balance_transactions`). */
export interface BalanceTxn {
  id: string; // txn_...
  type: string;
  amountCents: number;
  feeCents: number;
  netCents: number;
  availableOn?: string;
}

export interface IntentResult {
  id: string;
  status:
    "requires_action" | "requires_capture" | "succeeded" | "canceled" | "requires_payment_method";
  amountCents: number;
  clientSecret?: string;
  chargeId?: string;
  captureBefore?: string;
  paymentMethodId?: string;
  declineCode?: string;
  balanceTxn?: BalanceTxn;
}

export interface Method {
  id: string;
  brand: string;
  last4: string;
  expMonth: number;
  expYear: number;
  simulated: boolean;
}

export type ConnectComponent =
  "account_onboarding" | "notification_banner" | "payouts" | "account_management";

export interface AccountStatus {
  accountId: string;
  transfersActive: boolean;
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
  requirementsDue: string[];
  disabledReason?: string;
  bankLast4?: string;
}

export interface SetupResult {
  status: string;
  clientSecret?: string;
  paymentMethodId?: string;
  setupIntentId: string;
}

export interface PaymentsProvider {
  readonly name: "fake" | "stripe";

  // ---- Deprecated wrappers (current handlers still call these) ----
  /** @deprecated use holdOnSession / holdOffSession. Card authorization with manual capture. */
  authorize(i: AuthorizeInput): Promise<PaymentIntentResult>;
  /** Capture up to the authorized amount (Stripe `amount_to_capture`); the remainder is released. */
  capture(
    paymentIntentId: string,
    amountCents: number,
    idempotencyKey: string,
  ): Promise<PaymentIntentResult>;
  /** Void an uncaptured authorization. */
  cancel(paymentIntentId: string, idempotencyKey: string): Promise<void>;
  /** @deprecated use chargeOffSession / chargeOnSession. Immediate (automatic capture) card charge. */
  charge(i: ChargeInput): Promise<PaymentIntentResult>;
  refund(
    paymentIntentId: string,
    amountCents: number,
    idempotencyKey: string,
  ): Promise<{ id: string }>;
  transfer(i: TransferInput): Promise<{ id: string }>;

  // ---- Payments (WS4: stripe/payments.ts, fake/payments.ts) ----
  ensureCustomer(userId: string, email: string): Promise<{ customerId: string }>;
  customerSession(customerId: string): Promise<{ clientSecret: string } | { simulated: true }>;
  holdOnSession(i: {
    amountCents: number;
    customerId: string;
    payment: PaymentInput;
    bookingId: string;
    idempotencyKey: string;
  }): Promise<IntentResult>;
  setupOnSession(i: {
    customerId: string;
    payment: PaymentInput;
    idempotencyKey: string;
  }): Promise<SetupResult>;
  holdOffSession(i: {
    amountCents: number;
    customerId: string;
    paymentMethodId: string;
    bookingId: string;
    kind: "hold" | "rehold";
    idempotencyKey: string;
  }): Promise<IntentResult>;
  chargeOffSession(i: {
    amountCents: number;
    customerId: string;
    paymentMethodId: string;
    bookingId: string;
    kind: "extras" | "fee" | "capture_fallback";
    idempotencyKey: string;
  }): Promise<IntentResult>;
  chargeOnSession(i: {
    amountCents: number;
    customerId: string;
    paymentMethodId: string;
    bookingId: string;
    kind: "tip";
    idempotencyKey: string;
  }): Promise<IntentResult>;
  retrieveIntent(id: string): Promise<IntentResult>;
  listMethods(customerId: string): Promise<Method[]>;
  detachMethod(pmId: string): Promise<void>;

  // ---- Connect (WS5: stripe/connect.ts, fake/connect.ts) ----
  createConnectedAccount(i: {
    taskerId: string;
    email: string;
    idempotencyKey: string;
  }): Promise<{ accountId: string }>;
  accountSession(
    accountId: string,
    components: ConnectComponent[],
  ): Promise<{ clientSecret: string }>;
  accountLink(accountId: string, refreshUrl: string, returnUrl: string): Promise<{ url: string }>;
  retrieveAccount(accountId: string): Promise<AccountStatus>;
  reverseTransfer(
    transferId: string,
    amountCents: number,
    idempotencyKey: string,
  ): Promise<{ id: string }>;
}

export class PaymentError extends Error {
  constructor(
    public code: string,
    message: string,
    public httpStatus = 402,
  ) {
    super(message);
  }
}

/** Placeholder body for new-contract methods that a later workstream implements. */
export function notImplemented(method: string): never {
  throw new PaymentError(
    "not_implemented",
    `payments provider method ${method} is not implemented yet`,
    501,
  );
}
