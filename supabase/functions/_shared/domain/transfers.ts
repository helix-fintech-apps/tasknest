// Per-booking transfer planning (plan 7.3, G8). A Connect transfer funded by a charge uses
// `source_transaction`, which cannot exceed that charge. The tasker's share can exceed the card charges
// when points or promo funded part of the booking, so the rest is paid from the platform's available balance.

import { Cents } from "./money.ts";

export interface TransferCharge {
  chargeId: string; // ch_...
  amountCents: Cents; // what the charge captured
  alreadyTransferredCents: Cents; // already sent against this charge
}

export interface PlannedTransfer {
  /** The charge that funds the transfer, or null for the platform's available balance. */
  sourceTransaction: string | null;
  amountCents: Cents;
}

/**
 * Split `taskerShareCents` over the booking's charges in order (main, extras, tip), each up to what is left
 * on it; any remainder has no source charge. `adjustmentsCents` (<= 0: clawbacks, strike fees, disputes) are
 * netted against the share first, which is the same as netting them from the last transfers first. A net of
 * zero or less sends nothing (the negative balance carries over, as `planPayout` already does).
 */
export function planTransfers(
  taskerShareCents: Cents,
  charges: TransferCharge[],
  adjustmentsCents: Cents = 0,
): PlannedTransfer[] {
  for (const n of [taskerShareCents, adjustmentsCents]) {
    if (!Number.isInteger(n)) throw new Error("transfer amounts must be integer cents");
  }
  if (adjustmentsCents > 0) throw new Error("adjustments must be zero or negative");
  let remaining = taskerShareCents + adjustmentsCents;
  const out: PlannedTransfer[] = [];
  if (remaining <= 0) return out;
  for (const c of charges) {
    if (c.amountCents < 0 || c.alreadyTransferredCents < 0) {
      throw new Error("charge amounts must be non-negative");
    }
    const room = c.amountCents - c.alreadyTransferredCents;
    const t = Math.min(remaining, room);
    if (t > 0) {
      out.push({ sourceTransaction: c.chargeId, amountCents: t });
      remaining -= t;
    }
  }
  if (remaining > 0) out.push({ sourceTransaction: null, amountCents: remaining });
  return out;
}
