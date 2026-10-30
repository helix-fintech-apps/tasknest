// Booking state machine.

export type BookingStatus =
  | "pending_payment" // card needs an extra step (3DS); the slot is held, expires after 30 minutes
  | "payment_abandoned" // the pending payment expired or was dropped; slot, points and promo released
  | "requested" // client booked, card authorized, waiting for tasker
  | "accepted"
  | "in_progress"
  | "completed"
  | "canceled_client"
  | "canceled_tasker"
  | "declined" // tasker declined or didn't respond in time
  | "no_show_client"
  | "no_show_tasker"
  | "disputed";

const allowed: Record<BookingStatus, BookingStatus[]> = {
  pending_payment: ["requested", "payment_abandoned"],
  payment_abandoned: [],
  requested: ["accepted", "declined", "canceled_client"],
  accepted: [
    "in_progress",
    "canceled_client",
    "canceled_tasker",
    "no_show_client",
    "no_show_tasker",
  ],
  in_progress: ["completed", "no_show_client"],
  completed: ["disputed"],
  canceled_client: [],
  canceled_tasker: [],
  declined: [],
  no_show_client: ["disputed"],
  no_show_tasker: [],
  disputed: ["completed"], // dispute won -> back to completed
};

export function canTransition(from: BookingStatus, to: BookingStatus): boolean {
  return allowed[from]?.includes(to) ?? false;
}

export function assertTransition(from: BookingStatus, to: BookingStatus): void {
  if (!canTransition(from, to)) throw new Error(`illegal booking transition ${from} -> ${to}`);
}

/** Card authorizations expire; bookings further out than the validity window need re-authorization. */
export function needsReauth(
  bookedAt: Date,
  startAt: Date,
  validityDays: number,
  bufferDays: number,
): boolean {
  return startAt.getTime() - bookedAt.getTime() > (validityDays - bufferDays) * 86_400_000;
}

/** Statuses that hold the tasker's slot (matches the bookings_no_double_slot index). */
export const SLOT_HOLDING_STATUSES: BookingStatus[] = [
  "pending_payment",
  "requested",
  "accepted",
  "in_progress",
];

/** Statuses where non-card tenders are still held in client_funds_held (integrity view "open" booking). */
export const OPEN_STATUSES: BookingStatus[] = [...SLOT_HOLDING_STATUSES];

/** `bookings.payment_state` (docs/contracts.md 4.2). */
export type PaymentState =
  | "none" // no card involvement yet, or a v1 booking
  | "requires_action" // 3DS pending on the initial payment (booking is pending_payment)
  | "card_saved" // card saved, hold not placed yet (hold_at set)
  | "hold_active" // manual-capture hold in requires_capture; capture_before set
  | "action_required" // an off-session charge needs the client (authentication_required)
  | "hold_expired" // the hold was canceled by expiry before capture
  | "captured" // the main card amount was captured
  | "released" // the hold was canceled with no capture
  | "failed"; // unrecoverable (staff alerted)
