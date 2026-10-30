import { supabase, type PayoutRow, type StrikeRow } from "../supabase";
import { check } from "./common";

export async function taskerPayouts(taskerId?: string): Promise<PayoutRow[]> {
  let q = supabase
    .from("payouts")
    .select("id, tasker_id, amount_cents, booking_ids, status, created_at")
    .order("created_at", { ascending: false })
    .limit(100);
  if (taskerId) q = q.eq("tasker_id", taskerId);
  return check(await q) as PayoutRow[];
}

export async function taskerStrikes(taskerId: string): Promise<StrikeRow[]> {
  return check(
    await supabase
      .from("tasker_strikes")
      .select("id, tasker_id, booking_id, reason, fee_cents, created_at")
      .eq("tasker_id", taskerId)
      .order("created_at", { ascending: false }),
  ) as StrikeRow[];
}

/** Tasker payable balance from the ledger view; null when not readable. */
export async function taskerBalance(taskerId: string): Promise<number | null> {
  const res = await supabase
    .from("tasker_balances")
    .select("tasker_id, balance_cents")
    .eq("tasker_id", taskerId)
    .maybeSingle();
  if (res.error) return null;
  const row = res.data as { balance_cents: number } | null;
  return row ? Number(row.balance_cents) : 0;
}
