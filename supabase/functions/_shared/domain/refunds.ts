// Full, partial and goodwill refunds, plus disputes (chargebacks).

import { Cents, applyBps } from "./money.ts";
import { MoneyPolicy } from "./config.ts";
import { TenderParts, splitRefund, partsTotal } from "./tender.ts";
import { addDays } from "./time.ts";

export type RefundKind = "full" | "partial" | "goodwill";
export type Actor = "system" | "client" | "tasker" | "support_agent" | "admin";

export interface RefundRequest {
  kind: RefundKind;
  amountCents: Cents;
  actor: Actor;
  approvedBy?: string;   // required when an agent exceeds the limit
  reason: string;
  requestedAt: Date;
}

export interface RefundContext {
  paid: TenderParts;
  alreadyRefunded: TenderParts;
  completedAt: Date | null;
  subtotal: Cents;
  total: Cents;
  taskerCommissionOnSubtotal: Cents;
  taskerPaidOut: boolean;
  disputeOpen: boolean;
}

export interface RefundPlan {
  perTender: TenderParts;
  taskerClawbackCents: Cents;  // taken back from the tasker's share
  platformCostCents: Cents;    // absorbed by the platform
  requiresApproval: boolean;
}

export function planRefund(req: RefundRequest, ctx: RefundContext, policy: MoneyPolicy): RefundPlan {
  if (!req.reason.trim()) throw new Error("refund reason is required");
  if (req.amountCents <= 0) throw new Error("refund must be positive");
  if (ctx.disputeOpen) throw new Error("cannot refund while a dispute is open");
  if (ctx.completedAt && req.requestedAt > addDays(ctx.completedAt, policy.refunds.windowDays) && req.actor !== "admin") {
    throw new Error("refund window has passed");
  }
  const refundable = partsTotal(ctx.paid) - partsTotal(ctx.alreadyRefunded);
  const amount = req.kind === "full" ? refundable : req.amountCents;
  if (amount <= 0) throw new Error("nothing left to refund");
  if (amount > refundable) throw new Error(`refund exceeds refundable amount (${refundable})`);

  const requiresApproval = req.actor === "support_agent" && amount > policy.refunds.agentLimitCents;
  if (requiresApproval && !req.approvedBy) throw new Error("agent refund above limit needs approval");

  const perTender = splitRefund(amount, ctx.paid, ctx.alreadyRefunded, policy.refundOrder);

  // Cost split: goodwill is absorbed by the platform. Full/partial refunds are shared
  // with the tasker in proportion to the tasker's share of the total.
  let taskerClawback = 0;
  if (req.kind !== "goodwill") {
    const taskerShareOfTotal = ctx.subtotal - ctx.taskerCommissionOnSubtotal;
    taskerClawback = Math.floor((amount * taskerShareOfTotal) / ctx.total);
  }
  return { perTender, taskerClawbackCents: taskerClawback, platformCostCents: amount - taskerClawback, requiresApproval };
}

// ---- Disputes -------------------------------------------------------------

export type DisputeStatus = "needs_response" | "under_review" | "won" | "lost";

export interface DisputeOutcome {
  cardReversedCents: Cents;   // amount the card network takes back
  disputeFeeCents: Cents;
  recoverFromTaskerCents: Cents;
  platformLossCents: Cents;
}

/**
 * A card dispute only touches the card portion. When lost, recover the tasker's share
 * (proportional) from their balance; the platform absorbs the rest plus the fee.
 */
export function disputeLost(disputedCents: Cents, cardPaid: Cents, cardAlreadyRefunded: Cents, ctx: { subtotal: Cents; total: Cents; taskerCommission: Cents }, disputeFeeCents: Cents): DisputeOutcome {
  const reversible = cardPaid - cardAlreadyRefunded;
  const reversed = Math.min(disputedCents, reversible);
  const taskerShare = ctx.subtotal - ctx.taskerCommission;
  const recover = Math.floor((reversed * taskerShare) / ctx.total);
  return { cardReversedCents: reversed, disputeFeeCents, recoverFromTaskerCents: recover, platformLossCents: reversed - recover + disputeFeeCents };
}

export function serviceFeeShare(amount: Cents, policy: MoneyPolicy): Cents {
  return applyBps(amount, policy.clientServiceFeeBps);
}
