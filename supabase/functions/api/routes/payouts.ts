// Payout runs. Owner: WS5.

import * as payouts from "../handlers/payouts.ts";
import { Route } from "../route.ts";

export const routes: Route[] = [
  { method: "POST", pattern: /^\/payouts\/run$/, handler: payouts.runPayouts, idempotent: true },
];
