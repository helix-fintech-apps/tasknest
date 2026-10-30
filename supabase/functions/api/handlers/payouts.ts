// Payout runs (POST /payouts/run). Moved unchanged from admin.ts; WS5 owns this file from Wave 1.

import { EarningItem, MoneyPolicy, planPayout } from "../../_shared/domain/index.ts";
import { loadPolicy, UnitOfWork, withLocks } from "../../_shared/db.ts";
import {
  HttpError,
  optString,
  pgToHttp,
  toHttpError,
  UUID_RE,
  uuidFromKey,
} from "../../_shared/http.ts";
import { payoutTxn } from "../../_shared/postings.ts";
import { Ctx, requireRole } from "../context.ts";

// ---- POST /payouts/run -------------------------------------------------------------------------

interface PayableLine {
  id: number;
  debit: number;
  credit: number;
  ledger_txns: { booking_id: string | null } | null;
}

async function payoutForTasker(
  ctx: Ctx,
  t: { id: string; status: string; stripe_account_id: string | null },
  policy: MoneyPolicy,
) {
  const { data: lines, error: e1 } = await ctx.db
    .from("ledger_lines")
    .select("id, debit, credit, ledger_txns!inner(booking_id)")
    .eq("account", "tasker_payable")
    .eq("party", t.id)
    .eq("unit", "USD");
  if (e1) throw pgToHttp(e1);
  const { data: paidRows, error: e2 } = await ctx.db
    .from("payouts")
    .select("booking_ids")
    .eq("tasker_id", t.id)
    .eq("status", "paid");
  if (e2) throw pgToHttp(e2);
  const paidOut = new Set<string>((paidRows ?? []).flatMap((p) => p.booking_ids as string[]));

  let balance = 0;
  let lastLineId = 0;
  const netByBooking = new Map<string, number>();
  for (const l of (lines ?? []) as unknown as PayableLine[]) {
    const net = Number(l.credit) - Number(l.debit);
    balance += net;
    lastLineId = Math.max(lastLineId, Number(l.id));
    const bid = l.ledger_txns?.booking_id ?? null;
    if (bid) netByBooking.set(bid, (netByBooking.get(bid) ?? 0) + net);
  }
  const unpaidIds = [...netByBooking.keys()].filter((id) => !paidOut.has(id));
  const items: EarningItem[] = [];
  if (unpaidIds.length > 0) {
    const { data: bks, error: e3 } = await ctx.db
      .from("bookings")
      .select("id, status, completed_at, canceled_at, created_at")
      .in("id", unpaidIds);
    if (e3) throw pgToHttp(e3);
    for (const bk of bks ?? []) {
      items.push({
        bookingId: bk.id,
        netCents: netByBooking.get(bk.id) ?? 0,
        completedAt: new Date(bk.completed_at ?? bk.canceled_at ?? bk.created_at),
        cardSettled: bk.status !== "disputed",
        paidOut: false,
      });
    }
  }
  // Everything not attributable to an unpaid booking (earlier payouts, clawbacks/disputes on
  // bookings already paid out) is a balance adjustment; negative adjustments block the payout.
  const unpaidNet = items.reduce((a, i) => a + i.netCents, 0);
  const adjustments = balance - unpaidNet;
  const plan = planPayout(items, adjustments, t.status, ctx.now, policy);
  if (plan.amountCents <= 0) {
    return {
      taskerId: t.id,
      amountCents: 0,
      balanceCents: balance,
      blockedReason: plan.blockedReason ?? "nothing eligible",
    };
  }
  if (!t.stripe_account_id) {
    return {
      taskerId: t.id,
      amountCents: 0,
      balanceCents: balance,
      blockedReason: "no payout account (KYC incomplete)",
    };
  }
  // Same ledger state => same payout id and transfer idempotency key, so a retried run can't pay twice.
  const bookingIds = [...plan.bookingIds].sort();
  const payoutId = await uuidFromKey(
    `payout:${t.id}:${plan.amountCents}:${lastLineId}:${bookingIds.join(",")}`,
  );
  const tr = await ctx.provider.transfer({
    amountCents: plan.amountCents,
    destination: t.stripe_account_id,
    payoutId,
    idempotencyKey: `payout:${payoutId}`,
  });
  const uow = new UnitOfWork(`payout:${payoutId}`);
  uow.insert("payouts", {
    id: payoutId,
    tasker_id: t.id,
    amount_cents: plan.amountCents,
    booking_ids: bookingIds,
    stripe_transfer_id: tr.id,
    status: "paid",
  });
  uow.ledger(payoutTxn(t.id, plan.amountCents), payoutId);
  uow.audit(ctx.user.id, "payout", "tasker", t.id, undefined, {
    payoutId,
    amountCents: plan.amountCents,
    bookingIds,
  });
  try {
    await uow.commit(ctx.db);
  } catch (e) {
    if (toHttpError(e).code !== "duplicate") throw e;
  }
  return {
    taskerId: t.id,
    payoutId,
    amountCents: plan.amountCents,
    bookingIds,
    transferId: tr.id,
    balanceCents: balance - plan.amountCents,
  };
}

export async function runPayouts(ctx: Ctx) {
  requireRole(ctx, "admin");
  const only = optString(ctx.body, "taskerId");
  if (only && !UUID_RE.test(only))
    throw new HttpError(400, "bad_request", "taskerId must be a uuid");
  const policy = await loadPolicy(ctx.db, undefined, ctx.now);
  let q = ctx.db.from("taskers").select("id, status, stripe_account_id").order("id");
  if (only) q = q.eq("id", only.toLowerCase());
  const { data: taskers, error } = await q;
  if (error) throw pgToHttp(error);
  if (only && (taskers ?? []).length === 0)
    throw new HttpError(404, "not_found", "tasker not found");

  const results = [];
  for (const t of taskers ?? []) {
    // One payout computation at a time per tasker (the lease spans the transfer and the ledger write).
    results.push(
      await withLocks(ctx.db, [`payout:${t.id}`], () => payoutForTasker(ctx, t, policy)),
    );
  }
  return { payouts: results };
}
