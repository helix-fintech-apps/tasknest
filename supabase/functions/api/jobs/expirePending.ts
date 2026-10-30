// expire-pending-payments: a booking left in `pending_payment` (the client never finished 3DS) past its
// `payment_expires_at` becomes `payment_abandoned`. The slot is freed, points and promo credit are returned and
// any open PaymentIntent is canceled, through the same release path as a decline (no fee, no strike).
//
// Runs every 5 minutes from pg_cron (migration 20261101000104) or from Test tools in fake mode. Safe to run
// twice: each booking is handled under its lock and only while it is still `pending_payment`.

import { loadBooking, loadPolicy, withLocks } from "../../_shared/db.ts";
import { HttpError, optString, pgToHttp, toHttpError, UUID_RE } from "../../_shared/http.ts";
import { Ctx } from "../context.ts";
import { providerFault } from "../handlers/bookings.ts";

export async function expirePendingPayments(ctx: Ctx) {
  const only = optString(ctx.body, "bookingId")?.toLowerCase();
  if (only && !UUID_RE.test(only))
    throw new HttpError(400, "bad_request", "bookingId must be a uuid");
  let q = ctx.db
    .from("bookings")
    .select("id, policy_version")
    .eq("status", "pending_payment")
    .lte("payment_expires_at", ctx.now.toISOString())
    .order("payment_expires_at")
    .limit(200);
  if (only) q = q.eq("id", only);
  const { data, error } = await q;
  if (error) throw pgToHttp(error);
  const abandoned: string[] = [];
  const errors: { bookingId: string; error: string }[] = [];
  for (const row of data ?? []) {
    const id = row.id as string;
    try {
      await withLocks(ctx.db, [`booking:${id}`], async () => {
        const b = await loadBooking(ctx.db, id);
        if (b.status !== "pending_payment") return; // confirmed or dropped meanwhile
        if (!b.payment_expires_at || new Date(b.payment_expires_at) > ctx.now) return;
        const policy = await loadPolicy(ctx.db, row.policy_version as number);
        const child: Ctx = { ...ctx, params: { id }, opKey: `${ctx.opKey}:expire-pending:${id}` };
        await providerFault(child, b, policy, "payment_abandoned", "payment not completed in time");
        abandoned.push(id);
      });
    } catch (e) {
      errors.push({ bookingId: id, error: toHttpError(e).message });
    }
  }
  return { checked: (data ?? []).length, abandoned, errors };
}
