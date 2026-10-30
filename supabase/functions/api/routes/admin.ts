// Admin: tasker status, policies, dispute simulation, points grants, test clock. Owner: WS6 (additive for WS7).

import * as admin from "../handlers/admin.ts";
import { ID, Route } from "../route.ts";

export const routes: Route[] = [
  {
    method: "POST",
    pattern: new RegExp(`^/admin/taskers/${ID}/status$`),
    handler: admin.setTaskerStatus,
    idempotent: true,
  },
  {
    method: "POST",
    pattern: /^\/admin\/policies$/,
    handler: admin.publishPolicy,
    idempotent: true,
  },
  {
    method: "POST",
    pattern: /^\/admin\/disputes\/simulate$/,
    handler: admin.simulateDispute,
    idempotent: true,
  },
  {
    method: "POST",
    pattern: /^\/admin\/points\/grant$/,
    handler: admin.grantPoints,
    idempotent: true,
  },
  { method: "POST", pattern: /^\/admin\/test-clock$/, handler: admin.testClock, idempotent: false },
];
