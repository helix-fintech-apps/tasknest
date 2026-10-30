import { supabase, type ReviewRow, type TaskerRow } from "../supabase";
import { check } from "./common";

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
