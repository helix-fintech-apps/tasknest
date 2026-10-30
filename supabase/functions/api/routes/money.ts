// Tips, refunds and reviews. Owner: WS7.

import * as money from "../handlers/money.ts";
import { booking, ID, Route } from "../route.ts";

export const routes: Route[] = [
  { method: "POST", pattern: booking("tip"), handler: money.tip, idempotent: true },
  {
    method: "POST",
    pattern: booking("tip-preview"),
    handler: money.tipPreview,
    idempotent: false,
  },
  {
    method: "POST",
    pattern: new RegExp(`^/bookings/${ID}/tips/${ID}/refund$`),
    handler: money.tipRefund,
    idempotent: true,
    params: ["id", "tipId"],
  },
  {
    method: "POST",
    pattern: booking("refund-preview"),
    handler: money.refundPreview,
    idempotent: false,
  },
  { method: "POST", pattern: booking("refund"), handler: money.refund, idempotent: true },
  { method: "POST", pattern: booking("review"), handler: money.review, idempotent: true },
];
