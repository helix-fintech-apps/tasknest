import { createClient } from "@supabase/supabase-js";

export const SUPABASE_URL = (
  import.meta.env.VITE_SUPABASE_URL || "https://pfqvqencsbxauafahezw.supabase.co"
).replace(/\/$/, "");
export const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || "";

if (!SUPABASE_ANON_KEY) {
  console.warn("VITE_SUPABASE_ANON_KEY is not set — copy .env.example to .env");
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY || "missing-anon-key", {
  auth: { persistSession: true, autoRefreshToken: true, storageKey: "tasknest-auth" },
});

export type Role = "client" | "tasker" | "admin" | "support_agent";
export type TaskerStatus = "pending" | "active" | "suspended";

export interface Profile {
  id: string;
  role: Role;
  full_name: string;
  home_tz: string;
}
export interface TaskerRow {
  id: string;
  headline: string;
  category: string;
  hourly_rate_cents: number;
  status: TaskerStatus;
  kyc_verified_at: string | null;
  suspended_at: string | null;
  created_at?: string;
}
export interface BookingRow {
  id: string;
  client_id: string;
  tasker_id: string;
  policy_version: number;
  status: import("@domain").BookingStatus;
  description: string;
  location_tz: string;
  start_at: string;
  original_start_at: string;
  est_minutes: number;
  rate_cents: number;
  subtotal_cents: number;
  service_fee_cents: number;
  tax_cents: number;
  total_cents: number;
  extra_cents: number;
  points_reserved: number;
  points_earned: number;
  promo_code: string | null;
  created_at: string;
  accepted_at: string | null;
  completed_at: string | null;
  canceled_at: string | null;
}
export interface TenderRow {
  booking_id: string;
  tender: import("@domain").Tender;
  amount_cents: number;
  refunded_cents: number;
  points: number;
}
export interface RefundRow {
  id: string;
  booking_id: string;
  kind: string;
  amount_cents: number;
  per_tender: unknown;
  tasker_clawback_cents: number;
  actor_role: string;
  reason: string;
  created_at: string;
}
export interface TipRow {
  id: string;
  booking_id: string;
  amount_cents: number;
  platform_fee_cents: number;
  created_at: string;
}
export interface ReviewRow {
  booking_id: string;
  rating: number;
  body: string;
  created_at: string;
}
export interface PointsLotRow {
  id: string;
  user_id: string;
  kind: "earn" | "bonus" | "reissue" | "debt";
  booking_id: string | null;
  points_initial: number;
  points_remaining: number;
  available_at: string;
  expires_at: string;
  created_at: string;
}
export interface PointsMovementRow {
  id: number;
  user_id: string;
  booking_id: string | null;
  lot_id: string | null;
  kind: string;
  points: number;
  created_at: string;
}
export interface PayoutRow {
  id: string;
  tasker_id: string;
  amount_cents: number;
  booking_ids: string[];
  status: string;
  created_at: string;
}
export interface StrikeRow {
  id: number;
  tasker_id: string;
  booking_id: string | null;
  reason: string;
  fee_cents: number;
  created_at: string;
}
export interface LedgerTxnRow {
  id: string;
  kind: string;
  booking_id: string | null;
  created_at: string;
}
export interface LedgerLineRow {
  id: number;
  txn_id: string;
  account: string;
  party: string | null;
  unit: "USD" | "POINTS";
  debit: number;
  credit: number;
}
export interface PromoCodeRow {
  code: string;
  kind: "fixed" | "percent";
  value: number;
  first_task_only: boolean;
  max_discount_cents: number | null;
  expires_at: string | null;
}
export interface PolicyRow {
  version: number;
  policy: import("@domain").MoneyPolicy;
  effective_from: string;
}
