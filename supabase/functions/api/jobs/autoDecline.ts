// auto-decline-requests: a booking request the tasker has not answered within the policy's response window is
// declined for them. The client's hold is released and any points or promo credit returned (the same path as a
// tasker decline, so the money is identical), and the client is told. Fixes the BACKEND_NOTES gap where a
// request simply expired in place.
//
// Runs every 10 minutes from pg_cron (migration 20261101000103) or from Test tools in fake mode. Safe to run
// twice: each booking is handled under its lease and only if it is still `requested`.

import { loadBooking, loadPolicy, withLocks } from "../../_shared/db.ts";
import { HttpError, optString, pgToHttp, toHttpError, UUID_RE } from "../../_shared/http.ts";
import { Ctx } from "../context.ts";
import { providerFault } from "../handlers/bookings.ts";

export async function autoDeclineRequests(ctx: Ctx) {
  // `bookingId` limits a run to one booking (Test tools and the API tests use it). Without it, every request
  // older than an hour is looked at; the booking's own policy decides whether it is due.
  const only = optString(ctx.body, "bookingId")?.toLowerCase();
  if (only && !UUID_RE.test(only))
    throw new HttpError(400, "bad_request", "bookingId must be a uuid");
  let q = ctx.db
    .from("bookings")
    .select("id, policy_version, created_at")
    .eq("status", "requested")
    .lt("created_at", new Date(ctx.now.getTime() - 3_600_000).toISOString())
    .order("created_at")
    .limit(200);
  if (only) q = q.eq("id", only);
  const { data, error } = await q;
  if (error) throw pgToHttp(error);
  const declined: string[] = [];
  const errors: { bookingId: string; error: string }[] = [];
  for (const row of data ?? []) {
    const id = row.id as string;
    const policy = await loadPolicy(ctx.db, row.policy_version as number);
    const due =
      new Date(row.created_at as string).getTime() + policy.booking.taskerResponseHours * 3_600_000;
    if (ctx.now.getTime() <= due) continue;
    try {
      await withLocks(ctx.db, [`booking:${id}`], async () => {
        const b = await loadBooking(ctx.db, id);
        if (b.status !== "requested") return; // answered meanwhile
        const child: Ctx = { ...ctx, params: { id }, opKey: `${ctx.opKey}:auto-decline:${id}` };
        await providerFault(child, b, policy, "declined", "no response from the tasker in time");
        declined.push(id);
      });
    } catch (e) {
      errors.push({ bookingId: id, error: toHttpError(e).message });
    }
  }
  return { checked: (data ?? []).length, declined, errors };
}
