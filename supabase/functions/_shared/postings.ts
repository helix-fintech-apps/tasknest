// Ledger postings for each money event, built with the domain ledger helpers (txn/dr/cr).
// Chart of accounts: see domain/ledger.ts. POINTS unit lines move points between
// `points_issued` (platform) and `points_outstanding` (per user).
//
// Two-phase booking model:
//   1. Booking created: the non-card tenders (points, wallet, promo credit) are committed to the
//      booking and held in `client_funds_held` (booking_hold). Reserved points leave the user's
//      `points_outstanding`, so per user: ledger points_outstanding == sum(points_lots.points_remaining).
//      A card AUTHORIZATION is not a money movement (nothing is collected until capture), so it is
//      recorded on the booking (payment intent, auth expiry), never in `card_clearing`.
//   2. Capture (completion, or a cancellation / no-show fee): the captured card amount joins the held
//      funds and the kept amount is recognized as tasker pay, platform revenue and tax.
//   3. Whatever is not kept goes back (booking_release). After a booking closes its
//      `client_funds_held` nets to zero.

import { cr, dr, Line, TenderParts, Txn, txn } from "./domain/index.ts";

const nonCard = (p: TenderParts) => p.points + p.wallet + p.promo;

/** Booking created: commit the non-card tenders to the booking. Null when the booking is card-only. */
export function holdTxn(
  bookingId: string,
  clientId: string,
  parts: TenderParts,
  points: number,
): Txn | null {
  const held = nonCard(parts);
  if (held === 0 && points === 0) return null;
  return txn(
    "booking_hold",
    [
      dr("points_liability", parts.points),
      dr("wallet_liability", parts.wallet, clientId),
      dr("promo_expense", parts.promo),
      cr("client_funds_held", held, clientId),
      dr("points_outstanding", points, clientId, "POINTS"),
      cr("points_issued", points, undefined, "POINTS"),
    ],
    bookingId,
  );
}

/** Held non-card tenders go back to the client (decline, cancellation, tasker fault). */
export function releaseHoldTxn(
  bookingId: string,
  clientId: string,
  parts: TenderParts,
  points: number,
): Txn | null {
  const back = nonCard(parts);
  if (back === 0 && points === 0) return null;
  return txn(
    "booking_release",
    [
      dr("client_funds_held", back, clientId),
      cr("points_liability", parts.points),
      cr("wallet_liability", parts.wallet, clientId),
      cr("promo_expense", parts.promo),
      dr("points_issued", points, undefined, "POINTS"),
      cr("points_outstanding", points, clientId, "POINTS"),
    ],
    bookingId,
  );
}

/**
 * Capture: `cardCaptured` joins the funds held for the booking, then the kept amount
 * (captured card + `heldKept` non-card tenders) is recognized as tasker pay, platform revenue and tax.
 */
export function captureTxn(
  kind: string,
  bookingId: string,
  clientId: string,
  taskerId: string,
  cardCaptured: number,
  heldKept: number,
  alloc: { taskerPay: number; platform: number; tax: number },
): Txn {
  const recognized = alloc.taskerPay + alloc.platform + alloc.tax;
  if (recognized !== cardCaptured + heldKept) {
    throw new Error(
      `${kind}: recognized ${recognized} != captured ${cardCaptured} + held ${heldKept}`,
    );
  }
  return txn(
    kind,
    [
      dr("card_clearing", cardCaptured),
      cr("client_funds_held", cardCaptured, clientId),
      dr("client_funds_held", recognized, clientId),
      cr("tasker_payable", alloc.taskerPay, taskerId),
      cr("platform_revenue", alloc.platform),
      cr("tax_payable", alloc.tax),
    ],
    bookingId,
  );
}

export function extrasTxn(
  bookingId: string,
  taskerId: string,
  x: { card: number; taskerPay: number; platform: number; tax: number },
): Txn {
  return txn(
    "extras_charged",
    [
      dr("card_clearing", x.card),
      cr("tasker_payable", x.taskerPay, taskerId),
      cr("platform_revenue", x.platform),
      cr("tax_payable", x.tax),
    ],
    bookingId,
  );
}

/** Issue points (earn / bonus / reissue / return): liability booked against promo expense. */
export function pointsIssueTxn(
  kind: string,
  bookingId: string | undefined,
  userId: string,
  points: number,
  centsPerPoint: number,
): Txn {
  return txn(
    kind,
    [
      dr("points_issued", points, undefined, "POINTS"),
      cr("points_outstanding", points, userId, "POINTS"),
      dr("promo_expense", points * centsPerPoint),
      cr("points_liability", points * centsPerPoint),
    ],
    bookingId,
  );
}

/** Remove points (clawback). */
export function pointsClawbackLines(userId: string, points: number, centsPerPoint: number): Line[] {
  return [
    dr("points_outstanding", points, userId, "POINTS"),
    cr("points_issued", points, undefined, "POINTS"),
    dr("points_liability", points * centsPerPoint),
    cr("promo_expense", points * centsPerPoint),
  ];
}

export function tipTxn(bookingId: string, taskerId: string, amount: number): Txn {
  return txn(
    "tip",
    [dr("card_clearing", amount), cr("tasker_payable", amount, taskerId)],
    bookingId,
  );
}

export function taskerPenaltyTxn(bookingId: string, taskerId: string, fee: number): Txn {
  return txn(
    "tasker_penalty",
    [dr("tasker_payable", fee, taskerId), cr("platform_revenue", fee)],
    bookingId,
  );
}

/**
 * Refund: money goes back out through each tender; the tasker's share is clawed back from
 * tasker_payable and the platform absorbs the rest (refund_expense). Returned points are re-issued
 * on the POINTS unit; earned points on the reversed card cash are clawed back.
 */
export function refundTxn(
  kind: string,
  bookingId: string,
  clientId: string,
  taskerId: string,
  perTender: TenderParts,
  taskerClawback: number,
  pointsReturned: number,
  pointsClawedBack: number,
  centsPerPoint: number,
): Txn {
  const amount = perTender.card + perTender.points + perTender.wallet + perTender.promo;
  const lines: Line[] = [
    dr("tasker_payable", taskerClawback, taskerId),
    dr("refund_expense", amount - taskerClawback),
    cr("card_clearing", perTender.card),
    cr("wallet_liability", perTender.wallet, clientId),
    cr("points_liability", perTender.points),
    cr("promo_expense", perTender.promo),
    dr("points_issued", pointsReturned, undefined, "POINTS"),
    cr("points_outstanding", pointsReturned, clientId, "POINTS"),
    ...pointsClawbackLines(clientId, pointsClawedBack, centsPerPoint),
  ];
  return txn(kind, lines, bookingId);
}

export function disputeLostTxn(
  bookingId: string,
  clientId: string,
  taskerId: string,
  o: { reversed: number; fee: number; recover: number; platformLoss: number },
  pointsClawedBack: number,
  centsPerPoint: number,
): Txn {
  return txn(
    "dispute_lost",
    [
      dr("tasker_payable", o.recover, taskerId),
      dr("dispute_loss", o.platformLoss),
      cr("card_clearing", o.reversed + o.fee),
      ...pointsClawbackLines(clientId, pointsClawedBack, centsPerPoint),
    ],
    bookingId,
  );
}

export function payoutTxn(taskerId: string, amount: number): Txn {
  return txn("payout", [
    dr("tasker_payable", amount, taskerId),
    cr("payouts_clearing", amount, taskerId),
  ]);
}

// ---- Marketplace additions (plan 7.2) ----------------------------------------------------------------

/** Processing fee from a Stripe balance transaction: Stripe takes it out of the money we collected. */
export function stripeFeeTxn(bookingId: string, feeCents: number): Txn | null {
  if (feeCents <= 0) return null;
  return txn("stripe_fee", [dr("stripe_fees", feeCents), cr("card_clearing", feeCents)], bookingId);
}

/**
 * A dispute withdraws the disputed amount (and charges a fee) from the Stripe balance at once [S16]:
 * "Debits the disputed amount, plus a dispute fee". The amount waits in dispute_hold for the outcome.
 */
export function disputeOpenedTxn(bookingId: string, amountCents: number, feeCents: number): Txn {
  return txn(
    "dispute_opened",
    [
      dr("dispute_hold", amountCents),
      dr("dispute_fees", feeCents),
      cr("card_clearing", amountCents + feeCents),
    ],
    bookingId,
  );
}

/** Submitting evidence can cost a countered fee (taken now, returned if the dispute is won). */
export function disputeCounteredTxn(bookingId: string, feeCents: number): Txn | null {
  if (feeCents <= 0) return null;
  return txn(
    "dispute_countered",
    [dr("dispute_fees", feeCents), cr("card_clearing", feeCents)],
    bookingId,
  );
}

/** Dispute won: the withdrawn amount is reinstated, and so is the countered fee. The first fee is not [S16]. */
export function disputeWonTxn(
  bookingId: string,
  amountCents: number,
  counteredFeeCents: number,
): Txn {
  return txn(
    "dispute_won",
    [
      dr("card_clearing", amountCents + counteredFeeCents),
      cr("dispute_hold", amountCents),
      cr("dispute_fees", counteredFeeCents),
    ],
    bookingId,
  );
}

/**
 * Dispute lost after the money was already withdrawn and booked at open (disputeOpenedTxn): release the hold
 * into the tasker's recovered share and the platform's loss. The fee was booked at open and is not repeated.
 */
export function disputeLostAfterOpenTxn(
  bookingId: string,
  clientId: string,
  taskerId: string,
  o: { heldCents: number; recover: number },
  pointsClawedBack: number,
  centsPerPoint: number,
): Txn {
  return txn(
    "dispute_lost",
    [
      dr("tasker_payable", o.recover, taskerId),
      dr("dispute_loss", o.heldCents - o.recover),
      cr("dispute_hold", o.heldCents),
      ...pointsClawbackLines(clientId, pointsClawedBack, centsPerPoint),
    ],
    bookingId,
  );
}

/**
 * A card refund failed [S15]: the client was not paid back. Reverse the card part of the refund. The tasker's
 * clawback is reversed in proportion to the card share of the refund (all of it when the refund was card-only).
 */
export function refundFailedTxn(
  bookingId: string,
  taskerId: string,
  r: { cardCents: number; totalCents: number; taskerClawbackCents: number },
): Txn {
  const clawBack =
    r.cardCents === r.totalCents
      ? r.taskerClawbackCents
      : Math.floor((r.taskerClawbackCents * r.cardCents) / r.totalCents);
  return txn(
    "refund_failed",
    [
      dr("card_clearing", r.cardCents),
      cr("refund_expense", r.cardCents - clawBack),
      cr("tasker_payable", clawBack, taskerId),
    ],
    bookingId,
  );
}

/** Staff refund a tip: the whole amount comes back from the tasker (tips pass through 100%). */
export function tipRefundTxn(bookingId: string, taskerId: string, amountCents: number): Txn {
  return txn(
    "tip_refund",
    [dr("tasker_payable", amountCents, taskerId), cr("card_clearing", amountCents)],
    bookingId,
  );
}

/** A transfer to the tasker's payout account was reversed: the tasker owes it again. */
export function transferReversalTxn(taskerId: string, amountCents: number): Txn {
  return txn("transfer_reversal", [
    dr("payouts_clearing", amountCents, taskerId),
    cr("tasker_payable", amountCents, taskerId),
  ]);
}
