// Helpers for end-to-end API tests against a Supabase project (local stack in CI, or the deployed
// project) running the `api` Edge Function with the FAKE payments provider. No extra npm deps: plain fetch.
//
// Env:
//   SUPABASE_URL, SUPABASE_ANON_KEY   required (anon JWT or sb_publishable_ key); tests skip without them
//   API_BASE_URL                      optional, default `${SUPABASE_URL}/functions/v1/api`
//   SUPABASE_SERVICE_ROLE_KEY         optional; only used to check that the service key is limited to
//                                     /payouts/run. Never commit it.

export const SUPABASE_URL = (
  process.env.SUPABASE_URL ??
  process.env.VITE_SUPABASE_URL ??
  ""
).replace(/\/$/, "");
export const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY ?? "";
export const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
export const API_BASE_URL = (
  process.env.API_BASE_URL ?? `${SUPABASE_URL}/functions/v1/api`
).replace(/\/$/, "");
export const LIVE = Boolean(SUPABASE_URL && ANON_KEY);
export const SKIP_MESSAGE =
  "tests/api skipped: set SUPABASE_URL and SUPABASE_ANON_KEY (and optionally API_BASE_URL) to run the API tests " +
  "against a Supabase project whose `api` function uses PAYMENTS_PROVIDER=fake";

// Response bodies are dynamic JSON; tests assert on their shape.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Json = any;

export const PASSWORD = "TaskNest!2026";
export const USERS = {
  ava: { id: "00000000-0000-4000-a000-000000000001", email: "ava@tasknest.test" },
  ben: { id: "00000000-0000-4000-a000-000000000002", email: "ben@tasknest.test" },
  tara: { id: "00000000-0000-4000-a000-000000000011", email: "tara@tasknest.test" },
  leo: { id: "00000000-0000-4000-a000-000000000012", email: "leo@tasknest.test" },
  pia: { id: "00000000-0000-4000-a000-000000000013", email: "pia@tasknest.test" },
  admin: { id: "00000000-0000-4000-a000-000000000021", email: "admin@tasknest.test" },
  agent: { id: "00000000-0000-4000-a000-000000000022", email: "agent@tasknest.test" },
} as const;
export type Who = keyof typeof USERS;

const tokens = new Map<Who, Promise<string>>();

async function signIn(who: Who): Promise<string> {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON_KEY, "content-type": "application/json" },
    body: JSON.stringify({ email: USERS[who].email, password: PASSWORD }),
  });
  const body = (await res.json()) as Json;
  if (!body.access_token) throw new Error(`sign-in failed for ${who}: ${JSON.stringify(body)}`);
  return body.access_token as string;
}

export function token(who: Who): Promise<string> {
  if (!tokens.has(who)) tokens.set(who, signIn(who));
  return tokens.get(who)!;
}

export interface ApiResult<T = Json> {
  status: number;
  body: T;
  headers: Headers;
}

async function call(
  method: "GET" | "POST",
  path: string,
  headers: Record<string, string>,
  body?: unknown,
): Promise<ApiResult> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let parsed: Json;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }
  return { status: res.status, body: parsed, headers: res.headers };
}

// Test clock: `x-test-now` is only honored with a token an admin mints for that user (fake provider only).
const clockTokens = new Map<Who, Promise<string>>();

async function mintClockToken(who: Who): Promise<string> {
  const r = await call(
    "POST",
    "/admin/test-clock",
    {
      Authorization: `Bearer ${await token("admin")}`,
      apikey: ANON_KEY,
      "content-type": "application/json",
    },
    { userId: USERS[who].id, ttlSeconds: 3600 },
  );
  if (r.status !== 200)
    throw new Error(`test clock token for ${who}: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body.token as string;
}

export function clockToken(who: Who): Promise<string> {
  if (!clockTokens.has(who)) clockTokens.set(who, mintClockToken(who));
  return clockTokens.get(who)!;
}

export interface CallOpts {
  /** Idempotency-Key for POSTs: a string, false for none, default a fresh uuid. */
  idem?: string | false;
  /** Act at this time (test clock). */
  now?: Date | string;
  /** Send x-test-now WITHOUT the clock token (to test that it is rejected). */
  rawClock?: boolean;
}

export async function api(
  who: Who,
  method: "GET" | "POST",
  path: string,
  body?: unknown,
  opts: CallOpts = {},
): Promise<ApiResult> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${await token(who)}`,
    apikey: ANON_KEY,
    "content-type": "application/json",
  };
  if (method === "POST" && opts.idem !== false)
    headers["Idempotency-Key"] = opts.idem ?? crypto.randomUUID();
  if (opts.now) {
    headers["x-test-now"] = typeof opts.now === "string" ? opts.now : opts.now.toISOString();
    if (!opts.rawClock) headers["x-test-clock"] = await clockToken(who);
  }
  return call(method, path, headers, body);
}

/** Call with an arbitrary bearer token (e.g. none, or the service-role key). */
export function apiRaw(
  method: "GET" | "POST",
  path: string,
  bearer: string | null,
  body?: unknown,
): Promise<ApiResult> {
  const headers: Record<string, string> = { apikey: ANON_KEY, "content-type": "application/json" };
  if (bearer) headers.Authorization = `Bearer ${bearer}`;
  return call(method, path, headers, body);
}

/** PostgREST read as a user (RLS applies), or as anon when `who` is null. `query` is the raw query string. */
export async function rest<T = Json>(who: Who | null, table: string, query = ""): Promise<T[]> {
  const headers: Record<string, string> = { apikey: ANON_KEY };
  if (who) headers.Authorization = `Bearer ${await token(who)}`;
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, { headers });
  if (!res.ok) throw new Error(`rest ${table} ${res.status}: ${await res.text()}`);
  return (await res.json()) as T[];
}

export function expectOk(r: ApiResult, status = 200): void {
  if (r.status !== status)
    throw new Error(`expected HTTP ${status}, got ${r.status}: ${JSON.stringify(r.body)}`);
}

const DAY = 86_400_000;
const HOUR = 3_600_000;

export interface Slot {
  startAt: Date;
  localStart: string;
  tz: string;
}

/** A UTC slot on a random 15-minute boundary between `from` and `from + spanDays`. */
export function slotBetween(from: Date, spanDays: number): Slot {
  const day = Math.floor(from.getTime() / DAY) * DAY + Math.floor(Math.random() * spanDays) * DAY;
  const base = new Date(day + Math.floor(Math.random() * 96) * 15 * 60_000);
  return { startAt: base, localStart: base.toISOString().slice(0, 16), tz: "UTC" };
}

/**
 * A start time far enough ahead and random enough that repeated runs never collide on the same
 * tasker slot.
 */
export function freeSlot(minDaysAhead = 20): Slot {
  return slotBetween(new Date(Date.now() + minDaysAhead * DAY), 300);
}

export const hoursBefore = (d: Date, h: number) => new Date(d.getTime() - h * HOUR);
export const daysAfter = (d: Date, n: number) => new Date(d.getTime() + n * DAY);

export interface BookOpts {
  tasker?: Who;
  minutes?: number;
  pointsRequested?: number;
  promoCode?: string;
  slot?: Slot;
  paymentMethod?: string;
  now?: Date;
}

export async function book(client: Who, o: BookOpts = {}) {
  const slot = o.slot ?? freeSlot();
  const r = await api(
    client,
    "POST",
    "/bookings",
    {
      taskerId: USERS[o.tasker ?? "tara"].id,
      localStart: slot.localStart,
      tz: slot.tz,
      minutes: o.minutes ?? 120,
      description: "api test",
      pointsRequested: o.pointsRequested,
      promoCode: o.promoCode,
      paymentMethod: o.paymentMethod,
    },
    { now: o.now },
  );
  return { ...r, slot };
}

/** requested -> accepted -> in_progress -> completed */
export async function completeFlow(
  client: Who,
  o: BookOpts & { extraMinutes?: number; expensesCents?: number } = {},
) {
  const tasker = o.tasker ?? "tara";
  const b = await book(client, o);
  expectOk(b, 201);
  const id = b.body.booking.id as string;
  expectOk(await api(tasker, "POST", `/bookings/${id}/accept`, {}));
  expectOk(await api(tasker, "POST", `/bookings/${id}/start`, {}));
  const done = await api(tasker, "POST", `/bookings/${id}/complete`, {
    extraMinutes: o.extraMinutes,
    expensesCents: o.expensesCents,
  });
  expectOk(done);
  return { id, booking: b.body, completed: done.body };
}

export async function availablePoints(who: Who): Promise<number> {
  const rows = await rest<{ available: number }>(
    who,
    "points_balances",
    `user_id=eq.${USERS[who].id}`,
  );
  return rows[0]?.available ?? 0;
}

/** Make sure a client has at least `min` available points (admin test grant; fake provider only). */
export async function ensurePoints(who: Who, min: number): Promise<void> {
  const have = await availablePoints(who);
  if (have >= min) return;
  expectOk(
    await api("admin", "POST", "/admin/points/grant", {
      userId: USERS[who].id,
      points: min - have + 1000,
      reason: "api test top-up",
    }),
  );
}

export async function taskerBalance(tasker: Who): Promise<number> {
  const rows = await rest<{ balance_cents: number }>(
    "admin",
    "tasker_balances",
    `tasker_id=eq.${USERS[tasker].id}`,
  );
  return Number(rows[0]?.balance_cents ?? 0);
}

export async function ensureTaskerActive(tasker: Who): Promise<void> {
  const rows = await rest<{ status: string }>(
    "admin",
    "taskers",
    `id=eq.${USERS[tasker].id}&select=status`,
  );
  if (rows[0]?.status !== "active") {
    expectOk(
      await api("admin", "POST", `/admin/taskers/${USERS[tasker].id}/status`, {
        status: "active",
        reason: "api test reset",
      }),
    );
  }
}

export interface LedgerLine {
  account: string;
  party: string | null;
  unit: string;
  debit: number;
  credit: number;
  ledger_txns: { kind: string; booking_id: string };
}

export async function ledgerLinesFor(bookingId: string): Promise<LedgerLine[]> {
  return rest<LedgerLine>(
    "admin",
    "ledger_lines",
    `select=account,party,unit,debit,credit,ledger_txns!inner(kind,booking_id)&ledger_txns.booking_id=eq.${bookingId}`,
  );
}

/** Net credit - debit on an account (optionally for one party) across the given lines. */
export function net(lines: LedgerLine[], account: string, party?: string, unit = "USD"): number {
  return lines
    .filter(
      (l) => l.account === account && l.unit === unit && (party === undefined || l.party === party),
    )
    .reduce((a, l) => a + Number(l.credit) - Number(l.debit), 0);
}

export const kinds = (lines: LedgerLine[]) =>
  [...new Set(lines.map((l) => l.ledger_txns.kind))].sort();
