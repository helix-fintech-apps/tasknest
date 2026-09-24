// Card disputes (chargebacks). Used by the Stripe webhook and by the admin simulate hook (fake provider).

import { canTransition, clawbackPoints, disputeLost, BookingStatus } from "./domain/index.ts";
import {
  BookingRow,
  Db,
  loadLots,
  loadMovements,
  loadPolicy,
  loadTenders,
  UnitOfWork,
} from "./db.ts";
import { bookingFigures } from "./figures.ts";
import { disputeLostTxn } from "./postings.ts";
import * as pts from "./points-store.ts";
import { HttpError } from "./http.ts";

/** Stripe's dispute fee in the US. */
export const DISPUTE_FEE_CENTS = 1500;

export interface DisputeRow {
  id: string;
  booking_id: string;
  stripe_dispute_id: string | null;
  amount_cents: number;
  fee_cents: number;
  status: string;
  recovered_from_tasker_cents: number;
  created_at: string;
  closed_at: string | null;
}

export function openDispute(
  uow: UnitOfWork,
  b: BookingRow,
  disputeId: string,
  stripeDisputeId: string,
  amountCents: number,
): void {
  uow.insert("disputes", {
    id: disputeId,
    booking_id: b.id,
    stripe_dispute_id: stripeDisputeId,
    amount_cents: amountCents,
    status: "needs_response",
  });
  if (canTransition(b.status as BookingStatus, "disputed")) {
    uow.update("bookings", { id: b.id, status: b.status }, { status: "disputed" });
  }
  uow.audit(null, "dispute_opened", "booking", b.id, undefined, { stripeDisputeId, amountCents });
}

export async function closeDispute(
  db: Db,
  uow: UnitOfWork,
  b: BookingRow,
  d: DisputeRow,
  outcome: "won" | "lost",
  now: Date,
) {
  if (d.status === "won" || d.status === "lost")
    throw new HttpError(409, "dispute_closed", `dispute already ${d.status}`);
  if (outcome === "won") {
    uow.update("disputes", { id: d.id }, { status: "won", closed_at: now.toISOString() });
    if (b.status === "disputed" && b.completed_at)
      uow.update("bookings", { id: b.id, status: "disputed" }, { status: "completed" });
    uow.audit(null, "dispute_won", "booking", b.id);
    return { outcome, cardReversedCents: 0, recoverFromTaskerCents: 0 };
  }
  const policy = await loadPolicy(db, b.policy_version);
  const { paid, refunded } = await loadTenders(db, b.id);
  const f = bookingFigures(b, policy);
  const o = disputeLost(
    Number(d.amount_cents),
    paid.card,
    refunded.card,
    { subtotal: f.subtotal, total: f.total, taskerCommission: f.commission },
    DISPUTE_FEE_CENTS,
  );

  // The reversed card money is gone: count it as refunded so it can't be refunded again.
  if (o.cardReversedCents > 0)
    uow.inc(
      "booking_tenders",
      { booking_id: b.id, tender: "card" },
      "refunded_cents",
      o.cardReversedCents,
    );

  // Claw back points earned on the reversed card cash (cumulative, so repeated reversals never over-claw).
  const movs = await loadMovements(db, b.id);
  const lots = await loadLots(db, b.client_id);
  const target = clawbackPoints(b.points_earned, paid.card, refunded.card + o.cardReversedCents);
  const claw = Math.max(0, target - pts.clawedBack(movs));
  pts.clawback(uow, b.client_id, b.id, lots, claw, now);

  uow.ledger(
    disputeLostTxn(
      b.id,
      b.client_id,
      b.tasker_id,
      {
        reversed: o.cardReversedCents,
        fee: o.disputeFeeCents,
        recover: o.recoverFromTaskerCents,
        platformLoss: o.platformLossCents,
      },
      claw,
      policy.points.centsPerPoint,
    ),
    d.id,
  );
  uow.update(
    "disputes",
    { id: d.id },
    {
      status: "lost",
      closed_at: now.toISOString(),
      fee_cents: o.disputeFeeCents,
      recovered_from_tasker_cents: o.recoverFromTaskerCents,
    },
  );
  uow.audit(null, "dispute_lost", "booking", b.id, undefined, { ...o, pointsClawedBack: claw });
  return { outcome, ...o, pointsClawedBack: claw };
}
