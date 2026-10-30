// In-app notifications (docs/contracts.md 4.1 `notifications`). A notification is a non-money row written in the
// same unit of work as the event that causes it, so it exists if and only if the event committed.

import { UnitOfWork } from "./db.ts";

export type NotificationKind =
  | "booking_requested" // tasker: a new request
  | "booking_accepted" // client
  | "booking_declined" // client (tasker declined, or no response in time)
  | "booking_canceled" // the other party
  | "booking_rescheduled" // the other party
  | "booking_completed" // client: pay, rate and tip
  | "payment_abandoned" // client: the booking was not completed in time
  | "payment_action_required" // client: a charge needs their approval
  | "tip_received" // tasker
  | "tip_refunded" // tasker
  | "no_show_reported"; // tasker and staff queue

export function notify(
  uow: UnitOfWork,
  n: {
    userId: string;
    kind: NotificationKind;
    bookingId?: string;
    title: string;
    body?: string;
  },
): void {
  uow.insert("notifications", {
    user_id: n.userId,
    kind: n.kind,
    booking_id: n.bookingId ?? null,
    title: n.title,
    body: n.body ?? "",
  });
}
