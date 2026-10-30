// Quote and booking creation. Owner: WS7 (WS4 supplies the payment step).

import * as bookings from "../handlers/bookings.ts";
import { Route } from "../route.ts";

export const routes: Route[] = [
  { method: "POST", pattern: /^\/quote$/, handler: bookings.quoteHandler, idempotent: false },
  { method: "POST", pattern: /^\/bookings$/, handler: bookings.createBooking, idempotent: true },
];
