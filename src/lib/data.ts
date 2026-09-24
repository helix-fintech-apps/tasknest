// Read-side queries via supabase-js under RLS. No joins/embeds on purpose: each table is read
// separately so RLS on one table (e.g. profiles) can't hide rows of another.

import {
  supabase,
  type BookingRow,
  type LedgerLineRow,
  type LedgerTxnRow,
  type PayoutRow,
  type PointsLotRow,
  type DisputeRow,
  type PointsMovementRow,
  type PromoCodeRow,
  type RefundRow,
  type ReviewRow,
  type StrikeRow,
  type TaskerRow,
  type TenderRow,
  type TipRow,
} from "./supabase";

function check<T>(res: { data: T | null; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return (res.data ?? ([] as unknown)) as T;
}

/**
 * Public names from `display_names` (id, display_name): a tasker's full name, everyone else's first
 * name only. RLS shows a row to the user themself, staff, anyone for active taskers, and the other
 * party of a shared booking. `profiles` is private (own row and staff), so it is never used for names.
 */
export async function namesFor(ids: string[]): Promise<Map<string, string>> {
  const uniq = [...new Set(ids)].filter(Boolean);
  if (!uniq.length) return new Map();
  const res = await supabase.from("display_names").select("id, display_name").in("id", uniq);
  // Names hidden by RLS (or a read error) fall back to a generic label at the call site.
  if (res.error) return new Map();
  return new Map(
    (res.data as { id: string; display_name: string }[])
      .filter((r) => r.display_name?.trim())
      .map((r) => [r.id, r.display_name.trim()]),
  );
}

const TASKER_COLS =
  "id, display_name, headline, category, hourly_rate_cents, status, kyc_verified_at, suspended_at, created_at";

const taskerName = (r: TaskerRow) => r.display_name?.trim() || `${r.category} tasker`;

export interface TaskerCard extends TaskerRow {
  name: string;
  rating: number | null;
  reviews: number;
}

export async function listTaskers(opts: { includeAll?: boolean } = {}): Promise<TaskerCard[]> {
  let q = supabase.from("taskers").select(TASKER_COLS).order("category");
  if (!opts.includeAll) q = q.eq("status", "active");
  const rows = check(await q) as TaskerRow[];
  return rows.map((r) => ({ ...r, name: taskerName(r), rating: null, reviews: 0 }));
}

export async function getTasker(id: string): Promise<TaskerCard | null> {
  const res = await supabase.from("taskers").select(TASKER_COLS).eq("id", id).maybeSingle();
  const row = check(res) as TaskerRow | null;
  if (!row) return null;
  return { ...row, name: taskerName(row), rating: null, reviews: 0 };
}

export async function taskerReviews(taskerId: string): Promise<ReviewRow[]> {
  const bookings = check(
    await supabase
      .from("bookings")
      .select("id")
      .eq("tasker_id", taskerId)
      .eq("status", "completed"),
  ) as { id: string }[];
  if (!bookings.length) return [];
  return check(
    await supabase
      .from("reviews")
      .select("booking_id, rating, body, created_at")
      .in(
        "booking_id",
        bookings.map((b) => b.id),
      ),
  ) as ReviewRow[];
}

const BOOKING_COLS =
  "id, client_id, tasker_id, policy_version, status, description, location_tz, start_at, original_start_at, est_minutes, rate_cents, subtotal_cents, service_fee_cents, tax_cents, total_cents, extra_cents, extra_labor_cents, extra_service_fee_cents, extra_tax_cents, expenses_cents, points_reserved, points_earned, promo_code, created_at, accepted_at, completed_at, canceled_at";

const DISPUTE_COLS = "id, booking_id, amount_cents, fee_cents, status, created_at, closed_at";

export interface BookingBundle {
  booking: BookingRow;
  tenders: TenderRow[];
  refunds: RefundRow[];
  tips: TipRow[];
  /** Card disputes (chargebacks). Readable by the booking's client and tasker, and staff. */
  disputes: DisputeRow[];
  review: ReviewRow | null;
  clientName: string;
  taskerName: string;
}

export async function bundleBookings(bookings: BookingRow[]): Promise<BookingBundle[]> {
  const ids = bookings.map((b) => b.id);
  if (!ids.length) return [];
  const [tenders, refunds, tips, reviews, disputes, names] = await Promise.all([
    supabase
      .from("booking_tenders")
      .select("booking_id, tender, amount_cents, refunded_cents, points")
      .in("booking_id", ids)
      .then(check),
    supabase
      .from("refunds")
      .select(
        "id, booking_id, kind, amount_cents, per_tender, tasker_clawback_cents, actor_role, reason, created_at",
      )
      .in("booking_id", ids)
      .then(check),
    supabase
      .from("tips")
      .select("id, booking_id, amount_cents, platform_fee_cents, created_at")
      .in("booking_id", ids)
      .then(check),
    supabase
      .from("reviews")
      .select("booking_id, rating, body, created_at")
      .in("booking_id", ids)
      .then(check),
    disputesFor(ids),
    namesFor(bookings.flatMap((b) => [b.client_id, b.tasker_id])),
  ]);
  return bookings.map((b) => ({
    booking: b,
    tenders: (tenders as TenderRow[]).filter((t) => t.booking_id === b.id),
    refunds: (refunds as RefundRow[]).filter((t) => t.booking_id === b.id),
    tips: (tips as TipRow[]).filter((t) => t.booking_id === b.id),
    disputes: disputes.filter((d) => d.booking_id === b.id),
    review: (reviews as ReviewRow[]).find((r) => r.booking_id === b.id) ?? null,
    clientName: names.get(b.client_id) || "Client",
    taskerName: names.get(b.tasker_id) || "Tasker",
  }));
}

export async function myBookings(
  userId: string,
  as: "client" | "tasker",
): Promise<BookingBundle[]> {
  const rows = check(
    await supabase
      .from("bookings")
      .select(BOOKING_COLS)
      .eq(as === "client" ? "client_id" : "tasker_id", userId)
      .order("start_at", { ascending: false }),
  ) as BookingRow[];
  return bundleBookings(rows);
}

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

export async function clientHasBookings(userId: string): Promise<boolean> {
  const res = await supabase.from("bookings").select("id").eq("client_id", userId).limit(1);
  return (check(res) as unknown[]).length > 0;
}

export async function getPromo(code: string): Promise<PromoCodeRow | null> {
  const res = await supabase
    .from("promo_codes")
    .select("code, kind, value, first_task_only, max_discount_cents, expires_at")
    .eq("code", code.toUpperCase())
    .maybeSingle();
  return check(res) as PromoCodeRow | null;
}

export async function promoUsed(userId: string, code: string): Promise<boolean> {
  const res = await supabase
    .from("promo_redemptions")
    .select("code")
    .eq("user_id", userId)
    .eq("code", code.toUpperCase())
    .limit(1);
  return (check(res) as unknown[]).length > 0;
}

export async function pointsLots(userId: string): Promise<PointsLotRow[]> {
  return check(
    await supabase
      .from("points_lots")
      .select(
        "id, user_id, kind, booking_id, points_initial, points_remaining, available_at, expires_at, created_at",
      )
      .eq("user_id", userId)
      .order("expires_at"),
  ) as PointsLotRow[];
}

export async function pointsMovements(userId: string): Promise<PointsMovementRow[]> {
  return check(
    await supabase
      .from("points_movements")
      .select("id, user_id, booking_id, lot_id, kind, points, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(200),
  ) as PointsMovementRow[];
}

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

/** Disputes on these bookings (empty when none are readable). */
export async function disputesFor(bookingIds: string[]): Promise<DisputeRow[]> {
  if (!bookingIds.length) return [];
  const res = await supabase
    .from("disputes")
    .select(DISPUTE_COLS)
    .in("booking_id", bookingIds)
    .order("created_at", { ascending: false });
  if (res.error) return [];
  return (res.data ?? []) as DisputeRow[];
}
