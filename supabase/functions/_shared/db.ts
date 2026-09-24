// Database access for the API: service-role client, row types, loaders, leases and the atomic unit of work.

import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2";
import {
  DEFAULT_POLICY,
  MoneyPolicy,
  Txn,
  TenderParts,
  emptyParts,
  PointsLot,
} from "./domain/index.ts";
import { HttpError, pgToHttp } from "./http.ts";

export type Db = SupabaseClient;

interface DenoLike {
  env: { get(name: string): string | undefined };
}

export function env(name: string): string | undefined {
  const d = (globalThis as { Deno?: DenoLike }).Deno;
  return d?.env?.get(name) ?? undefined;
}

export function serviceClient(): Db {
  const url = env("SUPABASE_URL");
  const key = env("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) {
    throw new HttpError(500, "misconfigured", "SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set");
  }
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export function userClient(authHeader: string): Db {
  const url = env("SUPABASE_URL")!;
  const anon = env("SUPABASE_ANON_KEY")!;
  return createClient(url, anon, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Unwrap a supabase-js result, mapping Postgres errors to HTTP errors. */
export function must<T>(r: { data: T; error: unknown }, what: string): NonNullable<T> {
  if (r.error) throw pgToHttp(r.error as { code?: string; message?: string });
  if (r.data === null || r.data === undefined)
    throw new HttpError(404, "not_found", `${what} not found`);
  return r.data as NonNullable<T>;
}

// ---- Row types ------------------------------------------------------------------------------------

export interface BookingRow {
  id: string;
  client_id: string;
  tasker_id: string;
  policy_version: number;
  status: string;
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
  extra_labor_cents: number;
  extra_service_fee_cents: number;
  extra_tax_cents: number;
  expenses_cents: number;
  points_reserved: number;
  points_earned: number;
  promo_code: string | null;
  stripe_payment_intent_id: string | null;
  extra_payment_intent_id: string | null;
  captured_cents: number;
  provider_refunded_cents: number;
  auth_expires_at: string | null;
  created_at: string;
  accepted_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  canceled_at: string | null;
}

export interface TenderRow {
  booking_id: string;
  tender: keyof TenderParts;
  amount_cents: number;
  refunded_cents: number;
  points: number;
}

export interface LotRow {
  id: string;
  user_id: string;
  kind: string;
  booking_id: string | null;
  points_initial: number;
  points_remaining: number;
  available_at: string;
  expires_at: string;
}

export interface MovementRow {
  id: number;
  user_id: string;
  booking_id: string | null;
  lot_id: string | null;
  kind: string;
  points: number;
  created_at: string;
}

// ---- Loaders ---------------------------------------------------------------------------------------

const policyCache = new Map<number, MoneyPolicy>();

/**
 * A booking is always evaluated with ITS policy version. Without a version this returns the policy
 * in effect at `now` (highest version whose effective_from <= now), which is what new bookings snapshot.
 */
export async function loadPolicy(
  db: Db,
  version?: number,
  now: Date = new Date(),
): Promise<MoneyPolicy> {
  if (version !== undefined && policyCache.has(version)) return policyCache.get(version)!;
  let q = db.from("money_policies").select("version, policy");
  q = version !== undefined ? q.eq("version", version) : q.lte("effective_from", now.toISOString());
  const { data, error } = await q.order("version", { ascending: false }).limit(1);
  if (error) throw pgToHttp(error);
  if (!data || data.length === 0) {
    if (version === undefined || version === DEFAULT_POLICY.version) return DEFAULT_POLICY;
    throw new HttpError(500, "policy_missing", `money policy v${version} not found`);
  }
  const p = { ...(data[0].policy as MoneyPolicy), version: data[0].version as number };
  policyCache.set(p.version, p);
  return p;
}

export async function loadBooking(db: Db, id: string): Promise<BookingRow> {
  return must(
    await db.from("bookings").select("*").eq("id", id).maybeSingle(),
    "booking",
  ) as BookingRow;
}

export async function loadTenders(
  db: Db,
  bookingId: string,
): Promise<{ rows: TenderRow[]; paid: TenderParts; refunded: TenderParts; pointsUsed: number }> {
  const { data, error } = await db.from("booking_tenders").select("*").eq("booking_id", bookingId);
  if (error) throw pgToHttp(error);
  const paid = emptyParts();
  const refunded = emptyParts();
  let pointsUsed = 0;
  for (const r of (data ?? []) as TenderRow[]) {
    paid[r.tender] = Number(r.amount_cents);
    refunded[r.tender] = Number(r.refunded_cents);
    if (r.tender === "points") pointsUsed = r.points;
  }
  return { rows: (data ?? []) as TenderRow[], paid, refunded, pointsUsed };
}

export async function loadLots(db: Db, userId: string): Promise<LotRow[]> {
  const { data, error } = await db.from("points_lots").select("*").eq("user_id", userId);
  if (error) throw pgToHttp(error);
  return (data ?? []) as LotRow[];
}

/** Domain view of a user's spendable lots (debt lots excluded) plus the net balance including debt. */
export function lotsForDomain(
  rows: LotRow[],
  now: Date,
): { lots: PointsLot[]; debt: number; availableNet: number; pending: number } {
  const lots: PointsLot[] = rows
    .filter((r) => r.kind !== "debt" && r.points_remaining > 0)
    .map((r) => ({
      id: r.id,
      kind: r.kind as PointsLot["kind"],
      points: r.points_remaining,
      availableAt: new Date(r.available_at),
      expiresAt: new Date(r.expires_at),
    }));
  const debt = rows.filter((r) => r.kind === "debt").reduce((a, r) => a + r.points_remaining, 0); // <= 0
  const available = lots
    .filter((l) => l.availableAt <= now && l.expiresAt > now)
    .reduce((a, l) => a + l.points, 0);
  const pending = lots.filter((l) => l.availableAt > now).reduce((a, l) => a + l.points, 0);
  return { lots, debt, availableNet: available + debt, pending };
}

export async function loadMovements(db: Db, bookingId: string): Promise<MovementRow[]> {
  const { data, error } = await db
    .from("points_movements")
    .select("*")
    .eq("booking_id", bookingId)
    .order("id");
  if (error) throw pgToHttp(error);
  return (data ?? []) as MovementRow[];
}

// ---- Leases ------------------------------------------------------------------------------------------

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Run `fn` while holding short database leases (`op_locks`) on every key, e.g. `booking:<id>`,
 * `points:<userId>`, `payout:<taskerId>`. The lease covers the payment-provider call AND the
 * database transaction, so concurrent requests on the same booking are serialized end to end.
 * Waits up to `waitMs` for a busy key, then fails with a retryable 409 `busy`.
 */
export async function withLocks<T>(
  db: Db,
  keys: string[],
  fn: () => Promise<T>,
  opts: { waitMs?: number; ttlSeconds?: number } = {},
): Promise<T> {
  const waitMs = opts.waitMs ?? 5_000;
  const ttlSeconds = opts.ttlSeconds ?? 60;
  const token = crypto.randomUUID();
  const held: string[] = [];
  try {
    for (const key of [...new Set(keys)].sort()) {
      const deadline = Date.now() + waitMs;
      for (;;) {
        const { data, error } = await db.rpc("acquire_op_lock", {
          p_key: key,
          p_token: token,
          p_ttl_seconds: ttlSeconds,
        });
        if (error) throw pgToHttp(error);
        if (data === true) {
          held.push(key);
          break;
        }
        if (Date.now() >= deadline) {
          throw new HttpError(
            409,
            "busy",
            `another request is updating this ${key.split(":")[0]}; retry shortly`,
          );
        }
        await sleep(100 + Math.floor(Math.random() * 150));
      }
    }
    return await fn();
  } finally {
    for (const key of held.reverse()) {
      const { error } = await db.rpc("release_op_lock", { p_key: key, p_token: token });
      if (error) console.error("release_op_lock failed", key, error.message);
    }
  }
}

// ---- Unit of work -------------------------------------------------------------------------------

type Where = Record<string, string | number | boolean | null | (string | number)[]>;
type Row = Record<string, unknown>;

/**
 * Collects row operations and runs them atomically through the `tn_apply` RPC (one Postgres
 * transaction). Ledger txns are built with the domain `txn()` helper, so they are checked for
 * balance here AND by the database (post_ledger_txn + the deferred ledger_balanced trigger).
 */
export class UnitOfWork {
  ops: Row[] = [];
  constructor(private idemPrefix?: string) {}

  insert(table: string, row: Row | Row[]): this {
    this.ops.push(
      Array.isArray(row) ? { op: "insert", table, rows: row } : { op: "insert", table, row },
    );
    return this;
  }
  update(table: string, where: Where, set: Row, expect = 1): this {
    this.ops.push({ op: "update", table, where, set, expect });
    return this;
  }
  inc(table: string, where: Where, col: string, by: number, expect = 1): this {
    if (!Number.isInteger(by)) throw new Error(`inc ${table}.${col} by non-integer ${by}`);
    if (by !== 0) this.ops.push({ op: "inc", table, where, col, by, expect });
    return this;
  }
  delete(table: string, where: Where, expect = -1): this {
    this.ops.push({ op: "delete", table, where, expect });
    return this;
  }
  ledger(t: Txn | null, suffix?: string): this {
    if (!t || t.lines.length === 0) return this;
    this.ops.push({
      op: "ledger",
      kind: t.kind,
      booking_id: t.bookingId ?? "",
      idempotency_key: this.idemPrefix
        ? `${this.idemPrefix}:${t.kind}${suffix ? ":" + suffix : ""}`
        : null,
      lines: t.lines.map((l) => ({
        account: l.account,
        party: l.party ?? "",
        unit: l.unit,
        debit: l.debit,
        credit: l.credit,
      })),
    });
    return this;
  }
  assertSlotFree(
    taskerId: string,
    startAt: Date,
    minutes: number,
    excludeBookingId?: string,
  ): this {
    this.ops.push({
      op: "assert_slot_free",
      tasker_id: taskerId,
      start_at: startAt.toISOString(),
      minutes,
      exclude_booking_id: excludeBookingId ?? null,
    });
    return this;
  }
  lock(key: string): this {
    this.ops.push({ op: "lock", key });
    return this;
  }
  audit(
    actorId: string | null,
    action: string,
    entity: string,
    entityId: string,
    reason?: string,
    data?: unknown,
  ): this {
    return this.insert("audit_log", {
      actor_id: actorId,
      action,
      entity,
      entity_id: entityId,
      reason: reason ?? null,
      data: data ?? null,
    });
  }

  async commit(db: Db): Promise<{ ledger_txn_ids: string[] }> {
    if (this.ops.length === 0) return { ledger_txn_ids: [] };
    const { data, error } = await db.rpc("tn_apply", { ops: this.ops });
    if (error) throw pgToHttp(error);
    return data as { ledger_txn_ids: string[] };
  }
}
