// Stub for the payment step (contract: docs/contracts.md, section 4.6). WS4 replaces it.
// It renders nothing, so no page changes until a workstream mounts it.

/** Placeholder until WS4 defines the real request shape (docs/contracts.md section 4.3). */
export type PaymentInput = Record<string, unknown>;

export type PaymentPurpose = "booking" | "tip" | "add_card";

export interface PaymentSectionState {
  ready: boolean;
  payment?: PaymentInput;
  consent?: { textVersion: string };
  problem?: string;
}

export interface PaymentSectionProps {
  purpose: PaymentPurpose;
  plan: string;
  amountCents: number;
  onChange: (state: PaymentSectionState) => void;
  testIdPrefix?: string;
}

export function PaymentSection(props: PaymentSectionProps): null {
  void props;
  return null;
}
