// POST /jobs/:name: scheduled jobs, system only (service key). Registry: ../jobs/index.ts. Owner: WS7.

import { runJob } from "../jobs/index.ts";
import { Route } from "../route.ts";

export const routes: Route[] = [
  {
    method: "POST",
    pattern: /^\/jobs\/([a-z][a-z0-9_-]{0,63})$/,
    handler: runJob,
    idempotent: false,
    params: ["name"],
  },
];
