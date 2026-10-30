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
  /** Public name, kept in sync with the tasker's profile by the database. */
  display_name?: string;
  headline: string;
  category: string;
  hourly_rate_cents: number;
  status: TaskerStatus;
  kyc_verified_at: string | null;
  suspended_at: string | null;
  created_at?: string;
  bio?: string | null;
  avatar_url?: string | null;
  skills?: string[];
  service_zips?: string[];
  transfers_capability?: string | null;
  payouts_enabled?: boolean;
  details_submitted?: boolean;
  requirements_due?: string[];
  disabled_reason?: string | null;
  onboarding_completed_at?: string | null;
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
  /** Everything charged at completion: extra labor + its service fee + its tax + expenses. */
  extra_cents: number;
  extra_labor_cents?: number;
  extra_service_fee_cents?: number;
  extra_tax_cents?: number;
  expenses_cents?: number;
  points_reserved: number;
  points_earned: number;
  promo_code: string | null;
  created_at: string;
  accepted_at: string | null;
  completed_at: string | null;
  canceled_at: string | null;
  // Marketplace contract (docs/contracts.md section 4.1). Optional until every row carries them.
  category_slug?: string | null;
  address_id?: string | null;
  payment_plan?: PaymentPlan | null;
  payment_state?: PaymentState;
  hold_at?: string | null;
  capture_before?: string | null;
  stripe_charge_id?: string | null;
  payment_method_id?: string | null;
  payment_expires_at?: string | null;
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
export type DisputeStatus = "needs_response" | "under_review" | "won" | "lost";
export interface DisputeRow {
  id: string;
  booking_id: string;
  amount_cents: number;
  fee_cents: number;
  status: DisputeStatus;
  created_at: string;
  closed_at: string | null;
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

// ---------------------------------------------------------------------------------------------
// Row types for the marketplace contract tables (docs/contracts.md section 4.1). All money is
// integer cents. Read them through the typed helpers in src/lib/data; never compute from them in JSX.
// ---------------------------------------------------------------------------------------------

export type PaymentPlan = "hold_now" | "save_card_hold_later" | "card_not_needed";
export type PaymentState =
  | "none"
  | "requires_action"
  | "card_saved"
  | "hold_active"
  | "action_required"
  | "hold_expired"
  | "captured"
  | "released"
  | "failed";
export type ProviderRefundStatus =
  "pending" | "succeeded" | "failed" | "canceled" | "requires_action";
/** Stripe's dispute statuses (the contract widens the old four). */
export type StripeDisputeStatus =
  | "warning_needs_response"
  | "warning_under_review"
  | "warning_closed"
  | "needs_response"
  | "under_review"
  | "won"
  | "lost"
  | "prevented";

export interface CategoryRow {
  slug: string;
  name: string;
  icon: string;
  sort: number;
  active: boolean;
}
export interface AddressRow {
  id: string;
  user_id: string;
  label: string;
  line1: string;
  line2: string | null;
  city: string;
  state: string;
  zip: string;
  tz: string;
  is_default: boolean;
}
export interface TaskerAvailabilityRow {
  tasker_id: string;
  weekday: number;
  start_minute: number;
  end_minute: number;
}
export interface TaskerAvailabilityOverrideRow {
  tasker_id: string;
  date: string;
  kind: "block" | "add";
  start_minute: number | null;
  end_minute: number | null;
}
export interface PaymentIntentRow {
  id: string;
  booking_id: string;
  kind: "hold" | "rehold" | "extras" | "tip" | "fee";
  amount_cents: number;
  status: string;
  charge_id: string | null;
  capture_before: string | null;
  created_at: string;
}
export interface CardConsentRow {
  id: string;
  user_id: string;
  payment_method_id: string;
  booking_id: string | null;
  text_version: string;
  text_sha256: string;
  created_at: string;
}
export interface TransferRow {
  id: string;
  payout_id: string;
  booking_id: string;
  stripe_transfer_id: string | null;
  source_transaction: string | null;
  transfer_group: string;
  amount_cents: number;
  reversed_cents: number;
  status: "pending" | "created" | "failed" | "reversed";
}
export interface ConnectedPayoutRow {
  id: string;
  tasker_id: string;
  amount_cents: number;
  status: "pending" | "in_transit" | "paid" | "failed" | "canceled";
  arrival_date: string | null;
  failure_code: string | null;
  created_at: string;
}
export interface NotificationRow {
  id: string;
  user_id: string;
  kind: string;
  booking_id: string | null;
  title: string;
  body: string;
  read_at: string | null;
  created_at: string;
}
export interface MessageRow {
  id: string;
  booking_id: string;
  sender_id: string;
  body: string;
  system: boolean;
  created_at: string;
}
export type SupportRequestKind =
  "no_show" | "work_problem" | "charge_wrong" | "damage_safety" | "refund_request" | "other";
export interface SupportRequestRow {
  id: string;
  booking_id: string | null;
  requester_id: string;
  kind: SupportRequestKind;
  status: "open" | "waiting_on_customer" | "resolved";
  assignee_id: string | null;
  amount_at_stake_cents: number | null;
  due_at: string | null;
  resolution_note: string | null;
  created_at: string;
  resolved_at: string | null;
}
export interface SupportReplyRow {
  id: string;
  request_id: string;
  author_id: string;
  body: string;
  internal: boolean;
  created_at: string;
}
export interface RefundApprovalRow {
  id: string;
  booking_id: string;
  requested_by: string;
  kind: string;
  amount_cents: number;
  reason: string;
  preview: unknown;
  status: "pending" | "approved" | "rejected" | "executed";
  decided_by: string | null;
  decided_at: string | null;
}
