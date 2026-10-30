// The API route table: concatenation of the per-area route files. Each file exports `routes: Route[]`.
// Patterns are anchored and mutually exclusive, so the order here does not change which route matches.

import { Route } from "./route.ts";
import { routes as actions } from "./routes/actions.ts";
import { routes as admin } from "./routes/admin.ts";
import { routes as booking } from "./routes/booking.ts";
import { routes as connect } from "./routes/connect.ts";
import { routes as discovery } from "./routes/discovery.ts";
import { routes as jobs } from "./routes/jobs.ts";
import { routes as money } from "./routes/money.ts";
import { routes as payments } from "./routes/payments.ts";
import { routes as payouts } from "./routes/payouts.ts";
import { routes as sim } from "./routes/sim.ts";
import { routes as support } from "./routes/support.ts";
import { routes as tasker } from "./routes/tasker.ts";

export const routes: Route[] = [
  ...booking,
  ...actions,
  ...money,
  ...discovery,
  ...jobs,
  ...payments,
  ...tasker,
  ...connect,
  ...payouts,
  ...support,
  ...admin,
  ...sim,
];
