// Points bookkeeping on top of the domain rules (domain/points.ts). Every function only adds
// row operations to a UnitOfWork; nothing is written until the unit commits.
//
// Invariant kept by these helpers: for every user, sum(points_movements.points) == sum(points_lots.points_remaining).
//   reserve  -n  (lot decremented)              release +n (lot incremented back)
//   redeem   = release +n paired with redeem -n (lot untouched: the reserve already removed the points)
//   return   +n  (lot incremented) / reissue +n (new lot, when the original lot has expired)
//   release into an expired lot: release +n, expire -n (same lot), reissue +n (new short-lived lot)
//   earn/bonus +n (new lot)  ·  clawback -n (earn lot decremented, remainder to a negative "debt" lot)

import { addMonths, MoneyPolicy, newEarnLot, pointsToReturn } from "./domain/index.ts";
import { LotRow, MovementRow, UnitOfWork } from "./db.ts";

export const FAR_FUTURE = "9999-12-31T00:00:00Z";

export function reserve(
  uow: UnitOfWork,
  userId: string,
  bookingId: string,
  takes: { lotId: string; points: number }[],
): void {
  for (const t of takes) {
    if (t.points <= 0) continue;
    // points_remaining >= 0 check constraint makes a concurrent double-spend fail the whole unit.
    uow.inc("points_lots", { id: t.lotId }, "points_remaining", -t.points);
    uow.insert("points_movements", {
      user_id: userId,
      booking_id: bookingId,
      lot_id: t.lotId,
      kind: "reserve",
      points: -t.points,
    });
  }
}

/** Points still on hold for this booking, per lot. */
export function reservedByLot(movs: MovementRow[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const mv of movs) {
    if (!mv.lot_id || (mv.kind !== "reserve" && mv.kind !== "release")) continue;
    m.set(mv.lot_id, (m.get(mv.lot_id) ?? 0) - mv.points);
  }
  for (const [k, v] of m) if (v <= 0) m.delete(k);
  return m;
}

function newReissueLot(
  uow: UnitOfWork,
  userId: string,
  bookingId: string,
  points: number,
  now: Date,
  expiresAt: Date,
) {
  const lotId = crypto.randomUUID();
  uow.insert("points_lots", {
    id: lotId,
    user_id: userId,
    kind: "reissue",
    booking_id: bookingId,
    points_initial: points,
    points_remaining: points,
    available_at: now.toISOString(),
    expires_at: expiresAt.toISOString(),
  });
  uow.insert("points_movements", {
    user_id: userId,
    booking_id: bookingId,
    lot_id: lotId,
    kind: "reissue",
    points,
  });
}

/**
 * Release up to `count` reserved points back to their lots. Returns points released.
 * If a lot expired while its points were on hold, the released points expire at once and are
 * reissued in a new lot with the short reissue expiry (the same domain rule as refunds: pointsToReturn).
 */
export function release(
  uow: UnitOfWork,
  userId: string,
  bookingId: string,
  held: Map<string, number>,
  count: number,
  lots: LotRow[],
  now: Date,
  policy: MoneyPolicy,
): number {
  let left = count;
  for (const [lotId, pts] of held) {
    if (left <= 0) break;
    const n = Math.min(pts, left);
    if (n <= 0) continue;
    uow.inc("points_lots", { id: lotId }, "points_remaining", n);
    uow.insert("points_movements", {
      user_id: userId,
      booking_id: bookingId,
      lot_id: lotId,
      kind: "release",
      points: n,
    });
    const lot = lots.find((l) => l.id === lotId);
    if (lot) {
      const expiresAt = new Date(lot.expires_at);
      const [plan] = pointsToReturn([{ points: n, expiresAt }], now, policy);
      if (plan.expiresAt.getTime() !== expiresAt.getTime()) {
        uow.inc("points_lots", { id: lotId }, "points_remaining", -n);
        uow.insert("points_movements", {
          user_id: userId,
          booking_id: bookingId,
          lot_id: lotId,
          kind: "expire",
          points: -n,
        });
        newReissueLot(uow, userId, bookingId, n, now, plan.expiresAt);
      }
    }
    held.set(lotId, pts - n);
    left -= n;
  }
  return count - left;
}

/** Convert up to `count` reserved points into a redemption. Returns points redeemed. */
export function redeem(
  uow: UnitOfWork,
  userId: string,
  bookingId: string,
  held: Map<string, number>,
  count: number,
): number {
  let left = count;
  for (const [lotId, pts] of held) {
    if (left <= 0) break;
    const n = Math.min(pts, left);
    if (n <= 0) continue;
    uow.insert("points_movements", [
      { user_id: userId, booking_id: bookingId, lot_id: lotId, kind: "release", points: n },
      { user_id: userId, booking_id: bookingId, lot_id: lotId, kind: "redeem", points: -n },
    ]);
    held.set(lotId, pts - n);
    left -= n;
  }
  return count - left;
}

/**
 * Return redeemed points (refund of the points tender). Points go back to the lot they came from;
 * if that lot has expired they are reissued in a new lot with a short expiry (domain pointsToReturn).
 * Throws (before anything is written) if more points are requested than were redeemed and not yet returned.
 */
export function returnPoints(
  uow: UnitOfWork,
  userId: string,
  bookingId: string,
  movs: MovementRow[],
  lots: LotRow[],
  points: number,
  now: Date,
  policy: MoneyPolicy,
): number {
  if (points <= 0) return 0;
  const redeemed: { lotId: string; points: number; expiresAt: Date }[] = [];
  for (const mv of movs) {
    if (mv.kind !== "redeem" || !mv.lot_id) continue;
    const lot = lots.find((l) => l.id === mv.lot_id);
    redeemed.push({
      lotId: mv.lot_id,
      points: -mv.points,
      expiresAt: lot ? new Date(lot.expires_at) : now,
    });
  }
  // Skip what earlier refunds already returned. A "reissue" paired with an "expire" is a release into
  // an expired lot (not a return of redeemed points), so expires are netted out.
  const sumOf = (kinds: string[]) =>
    movs.filter((m) => kinds.includes(m.kind)).reduce((a, m) => a + m.points, 0);
  let alreadyReturned = sumOf(["return", "reissue"]) + sumOf(["expire"]);
  const open: { lotId: string; points: number; expiresAt: Date }[] = [];
  for (const r of redeemed) {
    const skip = Math.min(r.points, alreadyReturned);
    alreadyReturned -= skip;
    if (r.points - skip > 0) open.push({ ...r, points: r.points - skip });
  }
  let left = points;
  const take: { lotId: string; points: number; expiresAt: Date }[] = [];
  for (const r of open) {
    if (left <= 0) break;
    const n = Math.min(r.points, left);
    take.push({ ...r, points: n });
    left -= n;
  }
  if (left > 0) {
    throw new Error(
      `cannot return ${points} points: only ${points - left} were redeemed and not yet returned`,
    );
  }
  const plan = pointsToReturn(
    take.map((t) => ({ points: t.points, expiresAt: t.expiresAt })),
    now,
    policy,
  );
  plan.forEach((p, i) => {
    const src = take[i];
    if (p.expiresAt.getTime() === src.expiresAt.getTime()) {
      uow.inc("points_lots", { id: src.lotId }, "points_remaining", p.points);
      uow.insert("points_movements", {
        user_id: userId,
        booking_id: bookingId,
        lot_id: src.lotId,
        kind: "return",
        points: p.points,
      });
    } else {
      newReissueLot(uow, userId, bookingId, p.points, now, p.expiresAt);
    }
  });
  return points;
}

/** Issue an earn lot (pending for policy.points.pendingDays). */
export function earn(
  uow: UnitOfWork,
  userId: string,
  bookingId: string,
  points: number,
  completedAt: Date,
  policy: MoneyPolicy,
): string | null {
  if (points <= 0) return null;
  const lot = newEarnLot(crypto.randomUUID(), points, completedAt, policy);
  uow.insert("points_lots", {
    id: lot.id,
    user_id: userId,
    kind: "earn",
    booking_id: bookingId,
    points_initial: points,
    points_remaining: points,
    available_at: lot.availableAt.toISOString(),
    expires_at: lot.expiresAt.toISOString(),
  });
  uow.insert("points_movements", {
    user_id: userId,
    booking_id: bookingId,
    lot_id: lot.id,
    kind: "earn",
    points,
  });
  return lot.id;
}

export function bonus(
  uow: UnitOfWork,
  userId: string,
  bookingId: string | null,
  points: number,
  now: Date,
  policy: MoneyPolicy,
  availableAt = now,
): string {
  const id = crypto.randomUUID();
  uow.insert("points_lots", {
    id,
    user_id: userId,
    kind: "bonus",
    booking_id: bookingId,
    points_initial: points,
    points_remaining: points,
    available_at: availableAt.toISOString(),
    expires_at: addMonths(availableAt, policy.points.expiryMonths).toISOString(),
  });
  uow.insert("points_movements", {
    user_id: userId,
    booking_id: bookingId,
    lot_id: id,
    kind: "bonus",
    points,
  });
  return id;
}

/** Points already clawed back for a booking (positive number). */
export function clawedBack(movs: MovementRow[]): number {
  return -movs.filter((m) => m.kind === "clawback").reduce((a, m) => a + m.points, 0);
}

/**
 * Claw back earned points: first from the booking's own earn lot, the rest as a negative "debt"
 * lot, which makes the user's available balance negative and blocks redemptions until repaid.
 */
export function clawback(
  uow: UnitOfWork,
  userId: string,
  bookingId: string,
  lots: LotRow[],
  points: number,
  now: Date,
): { fromLot: number; debt: number } {
  if (points <= 0) return { fromLot: 0, debt: 0 };
  const earnLot = lots.find((l) => l.kind === "earn" && l.booking_id === bookingId);
  const fromLot = earnLot ? Math.min(earnLot.points_remaining, points) : 0;
  if (earnLot && fromLot > 0) {
    uow.inc("points_lots", { id: earnLot.id }, "points_remaining", -fromLot);
    uow.insert("points_movements", {
      user_id: userId,
      booking_id: bookingId,
      lot_id: earnLot.id,
      kind: "clawback",
      points: -fromLot,
    });
    earnLot.points_remaining -= fromLot;
  }
  const debt = points - fromLot;
  if (debt > 0) {
    const id = crypto.randomUUID();
    uow.insert("points_lots", {
      id,
      user_id: userId,
      kind: "debt",
      booking_id: bookingId,
      points_initial: debt,
      points_remaining: -debt,
      available_at: now.toISOString(),
      expires_at: FAR_FUTURE,
    });
    uow.insert("points_movements", {
      user_id: userId,
      booking_id: bookingId,
      lot_id: id,
      kind: "clawback",
      points: -debt,
    });
  }
  return { fromLot, debt };
}
