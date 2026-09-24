// Payments provider interface. Amounts are integer cents (USD).

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
}

export interface PaymentIntentResult {
  id: string;
  status: string;
  amountCents: number;
}

export interface PaymentsProvider {
  readonly name: "fake" | "stripe";
  /** Card authorization with manual capture. */
  authorize(i: AuthorizeInput): Promise<PaymentIntentResult>;
  /** Capture up to the authorized amount (Stripe `amount_to_capture`); the remainder is released. */
  capture(
    paymentIntentId: string,
    amountCents: number,
    idempotencyKey: string,
  ): Promise<PaymentIntentResult>;
  /** Void an uncaptured authorization. */
  cancel(paymentIntentId: string, idempotencyKey: string): Promise<void>;
  /** Immediate (automatic capture) card charge: extras, tips, re-authorizations. */
  charge(i: ChargeInput): Promise<PaymentIntentResult>;
  refund(
    paymentIntentId: string,
    amountCents: number,
    idempotencyKey: string,
  ): Promise<{ id: string }>;
  transfer(i: TransferInput): Promise<{ id: string }>;
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
