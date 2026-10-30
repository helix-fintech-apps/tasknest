// Scheduled job registry (plan 5 WS7 item 8). Run: SUPABASE_URL=... SUPABASE_ANON_KEY=... npx vitest run tests/api
import { describe, expect, it } from "vitest";
import { api, LIVE, runJob, SKIP_MESSAGE } from "./helpers.ts";

if (!LIVE) console.warn(SKIP_MESSAGE);

describe.skipIf(!LIVE)("jobs", () => {
  it("rejects a user token", async () => {
    const r = await api("admin", "POST", "/jobs/expire-pending-payments", {});
    expect(r.status).toBe(403);
  });
  it("404s an unknown job", async () => {
    const r = await runJob("no-such-job");
    expect(r.status).toBe(404);
  });
  it("expire-pending-payments runs and reports nothing due on a clean database", async () => {
    const r = await runJob("expire-pending-payments");
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body.abandoned)).toBe(true);
    expect(r.body.errors).toEqual([]);
  });
  it("auto-decline-requests runs", async () => {
    const r = await runJob("auto-decline-requests");
    expect(r.status).toBe(200);
  });
});
