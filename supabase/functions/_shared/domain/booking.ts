// Booking state machine.

export type BookingStatus =
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
