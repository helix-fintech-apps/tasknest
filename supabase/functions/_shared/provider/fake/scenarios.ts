// Shared pieces of the deterministic fake provider: ids, amount checks and the scenario switches.
// WS4 grows this file with the simulated test-card scenario table (docs/contracts.md 4.4, plan 6.6).

import { PaymentError } from "../types.ts";
import { sha256Hex } from "../../http.ts";

/** Payment method id that makes the fake provider decline (legacy `paymentMethod` field). */
export const FAKE_DECLINE_PM = "pm_card_chargeDeclined";

/** Object ids are derived from the idempotency key, so a retried call returns the same id. */
export async function fakeId(prefix: string, key: string): Promise<string> {
  return `${prefix}_fake_${(await sha256Hex(key)).slice(0, 24)}`;
}

export function checkAmount(n: number) {
  if (!Number.isInteger(n) || n <= 0)
    throw new PaymentError(
      "invalid_amount",
      `amount must be positive integer cents, got ${n}`,
      400,
    );
}
