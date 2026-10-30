import { supabase, type LedgerLineRow, type LedgerTxnRow } from "../supabase";
import { check } from "./common";
import { BOOKING_COLS, bundleBookings, type BookingBundle } from "./bookings";
import type { BookingRow } from "../supabase";

export async function searchBookings(opts: {
  status?: string;
  id?: string;
  limit?: number;
}): Promise<BookingBundle[]> {
  let q = supabase
    .from("bookings")
    .select(BOOKING_COLS)
    .order("created_at", { ascending: false })
    .limit(opts.limit ?? 50);
  if (opts.status) q = q.eq("status", opts.status);
  if (opts.id) q = q.eq("id", opts.id);
  return bundleBookings(check(await q) as BookingRow[]);
}

export interface LedgerTxn extends LedgerTxnRow {
  lines: LedgerLineRow[];
}

export async function ledger(opts: { bookingId?: string; limit?: number }): Promise<LedgerTxn[]> {
  let q = supabase
    .from("ledger_txns")
    .select("id, kind, booking_id, created_at")
    .order("created_at", { ascending: false })
    .limit(opts.limit ?? 50);
  if (opts.bookingId) q = q.eq("booking_id", opts.bookingId);
  const txns = check(await q) as LedgerTxnRow[];
  if (!txns.length) return [];
  const lines = check(
    await supabase
      .from("ledger_lines")
      .select("id, txn_id, account, party, unit, debit, credit")
      .in(
        "txn_id",
        txns.map((t) => t.id),
      )
      .order("id"),
  ) as LedgerLineRow[];
  return txns.map((t) => ({ ...t, lines: lines.filter((l) => l.txn_id === t.id) }));
}
