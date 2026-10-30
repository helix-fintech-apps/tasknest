// Scheduled job registry and the POST /jobs/:name handler. System only: the caller must authenticate with
// the function's service-role key (cron). Jobs land in later workstreams (docs/contracts.md 4.3):
// register one by adding it to `jobs` (WS4: payment jobs, WS5: payout jobs, WS7: housekeeping).

import { HttpError } from "../../_shared/http.ts";
import { Ctx } from "../context.ts";

export type Job = (ctx: Ctx) => Promise<unknown>;

/** job name -> implementation. Empty in Wave 0. */
export const jobs: Record<string, Job> = {};

export async function runJob(ctx: Ctx): Promise<unknown> {
  if (!ctx.user.system) {
    throw new HttpError(403, "forbidden", "jobs may only be run with the service key");
  }
  const name = ctx.params.name;
  const job = Object.hasOwn(jobs, name) ? jobs[name] : undefined;
  if (!job) throw new HttpError(404, "not_found", `unknown job ${name}`);
  return job(ctx);
}
