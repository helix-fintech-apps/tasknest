import {
  supabase,
  type BookingRow,
  type DisputeRow,
  type PointsLotRow,
  type PointsMovementRow,
  type PromoCodeRow,
  type RefundRow,
  type ReviewRow,
  type TenderRow,
  type TipRow,
} from "../supabase";
import { check, namesFor } from "./common";

export const BOOKING_COLS =
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
