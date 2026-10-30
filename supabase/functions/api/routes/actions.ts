// Booking lifecycle actions (accept, decline, reschedule, cancel, no-show, start, complete) and their
// previews. Owner: WS7.

import * as bookings from "../handlers/bookings.ts";
import { booking, Route } from "../route.ts";

export const routes: Route[] = [
  { method: "POST", pattern: booking("accept"), handler: bookings.accept, idempotent: true },
  { method: "POST", pattern: booking("decline"), handler: bookings.decline, idempotent: true },
  {
    method: "POST",
    pattern: booking("reschedule"),
    handler: bookings.reschedule,
    idempotent: true,
  },
  {
    method: "GET",
    pattern: booking("cancel-preview"),
    handler: bookings.cancelPreview,
    idempotent: false,
  },
  { method: "POST", pattern: booking("cancel"), handler: bookings.cancel, idempotent: true },
  { method: "POST", pattern: booking("no-show"), handler: bookings.noShow, idempotent: true },
  { method: "POST", pattern: booking("start"), handler: bookings.start, idempotent: true },
  { method: "POST", pattern: booking("complete"), handler: bookings.complete, idempotent: true },
  {
    method: "POST",
    pattern: booking("complete-preview"),
    handler: bookings.completePreview,
    idempotent: false,
  },
  {
    method: "GET",
    pattern: booking("no-show-preview"),
    handler: bookings.noShowPreview,
    idempotent: false,
  },
  {
    method: "POST",
    pattern: booking("reschedule-preview"),
    handler: bookings.reschedulePreview,
    idempotent: false,
  },
  {
    method: "POST",
    pattern: booking("report-no-show"),
    handler: bookings.reportNoShow,
    idempotent: true,
  },
];
