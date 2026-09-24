// In-browser mock of Supabase (auth + PostgREST) and the `api` Edge Function, so UI tests run
// without a live backend. Tests that need the real backend live in backend.spec.ts (E2E_BACKEND=1).

import type { Page, Request, Route } from "@playwright/test";
import { DEFAULT_POLICY } from "../supabase/functions/_shared/domain/config.ts";

export const PASSWORD = "TaskNest!2026";
const H = 3_600_000;

export const IDS = {
  ava: "00000000-0000-4000-8000-00000000a0a0",
  ben: "00000000-0000-4000-8000-00000000b0b0",
  tara: "00000000-0000-4000-8000-0000000071a0",
  leo: "00000000-0000-4000-8000-000000000170",
  pia: "00000000-0000-4000-8000-000000000919",
  admin: "00000000-0000-4000-8000-0000000ad000",
  agent: "00000000-0000-4000-8000-0000000a9e00",
  // bookings
  b72: "10000000-0000-4000-8000-000000000072",
  b36: "10000000-0000-4000-8000-000000000036",
  b2: "10000000-0000-4000-8000-000000000002",
  bDone: "10000000-0000-4000-8000-00000000d0e0",
  bReq: "10000000-0000-4000-8000-000000000e90",
  bProg: "10000000-0000-4000-8000-000000009e09",
};

type Row = Record<string, unknown>;

function booking(id: string, status: string, startMs: number, extra: Row = {}): Row {
  const iso = new Date(startMs).toISOString();
  return {
    id,
    client_id: IDS.ava,
    tasker_id: IDS.tara,
    policy_version: 1,
    status,
    description: "Mount TV",
    location_tz: "America/Los_Angeles",
    start_at: iso,
    original_start_at: iso,
    est_minutes: 120,
    rate_cents: 4500,
    subtotal_cents: 9000,
    service_fee_cents: 1350,
    tax_cents: 0,
    total_cents: 10350,
    extra_cents: 0,
    points_reserved: 0,
    points_earned: 0,
    promo_code: null,
    created_at: new Date(startMs - 100 * H).toISOString(),
    accepted_at: null,
    completed_at: null,
    canceled_at: null,
    ...extra,
  };
}

export function makeDb(now = Date.now()): Record<string, Row[]> {
  const profiles: Row[] = [
    {
      id: IDS.ava,
      role: "client",
      full_name: "Ava Client",
      home_tz: "America/Los_Angeles",
      email: "ava@tasknest.test",
    },
    {
      id: IDS.ben,
      role: "client",
      full_name: "Ben Client",
      home_tz: "America/New_York",
      email: "ben@tasknest.test",
    },
    {
      id: IDS.tara,
      role: "tasker",
      full_name: "Tara Tasker",
      home_tz: "America/Los_Angeles",
      email: "tara@tasknest.test",
    },
    {
      id: IDS.leo,
      role: "tasker",
      full_name: "Leo Tasker",
      home_tz: "America/Los_Angeles",
      email: "leo@tasknest.test",
    },
    {
      id: IDS.pia,
      role: "tasker",
      full_name: "Pia Tasker",
      home_tz: "America/Los_Angeles",
      email: "pia@tasknest.test",
    },
    {
      id: IDS.admin,
      role: "admin",
      full_name: "Admin",
      home_tz: "America/Los_Angeles",
      email: "admin@tasknest.test",
    },
    {
      id: IDS.agent,
      role: "support_agent",
      full_name: "Agent",
      home_tz: "America/Los_Angeles",
      email: "agent@tasknest.test",
    },
  ];
  const completedAt = new Date(now - 2 * 24 * H).toISOString();
  const bookings = [
    booking(IDS.b72, "accepted", now + 72 * H),
    booking(IDS.b36, "accepted", now + 36 * H),
    booking(IDS.b2, "accepted", now + 2 * H),
    booking(IDS.bDone, "completed", now - 3 * 24 * H, {
      completed_at: completedAt,
      points_earned: 103,
    }),
    booking(IDS.bReq, "requested", now + 5 * 24 * H, {
      client_id: IDS.ben,
      description: "Fix shelf",
    }),
    booking(IDS.bProg, "in_progress", now - 1 * H, {
      client_id: IDS.ben,
      description: "Assemble desk",
    }),
  ];
  const tenders: Row[] = [
    { booking_id: IDS.b72, tender: "card", amount_cents: 10350, refunded_cents: 0, points: 0 },
    { booking_id: IDS.b36, tender: "card", amount_cents: 10350, refunded_cents: 0, points: 0 },
    // Split tender: 5000 points + card. A late-cancel fee comes out of the card first.
    { booking_id: IDS.b2, tender: "card", amount_cents: 5350, refunded_cents: 0, points: 0 },
    { booking_id: IDS.b2, tender: "points", amount_cents: 5000, refunded_cents: 0, points: 5000 },
    { booking_id: IDS.bDone, tender: "card", amount_cents: 10350, refunded_cents: 0, points: 0 },
    { booking_id: IDS.bReq, tender: "card", amount_cents: 10350, refunded_cents: 0, points: 0 },
    { booking_id: IDS.bProg, tender: "card", amount_cents: 10350, refunded_cents: 0, points: 0 },
  ];
  const lot = (
    id: string,
    pts: number,
    availOffset: number,
    expOffset: number,
    kind = "earn",
  ): Row => ({
    id,
    user_id: IDS.ava,
    kind,
    booking_id: null,
    points_initial: pts,
    points_remaining: pts,
    available_at: new Date(now + availOffset).toISOString(),
    expires_at: new Date(now + expOffset).toISOString(),
    created_at: new Date(now - 30 * 24 * H).toISOString(),
  });
  return {
    profiles,
    taskers: [
      {
        id: IDS.tara,
        headline: "Mounting, repairs, furniture assembly",
        category: "Handyman",
        hourly_rate_cents: 4500,
        status: "active",
        kyc_verified_at: new Date(now).toISOString(),
        suspended_at: null,
      },
      {
        id: IDS.leo,
        headline: "Deep cleaning and move-outs",
        category: "Cleaning",
        hourly_rate_cents: 3800,
        status: "active",
        kyc_verified_at: new Date(now).toISOString(),
        suspended_at: null,
      },
      {
        id: IDS.pia,
        headline: "Moving help",
        category: "Moving",
        hourly_rate_cents: 6000,
        status: "pending",
        kyc_verified_at: null,
        suspended_at: null,
      },
    ],
    money_policies: [
      {
        version: 1,
        policy: DEFAULT_POLICY,
        effective_from: new Date(now - 90 * 24 * H).toISOString(),
      },
    ],
    bookings,
    booking_tenders: tenders,
    refunds: [],
    tips: [],
    reviews: [],
    points_lots: [
      lot("20000000-0000-4000-8000-000000000001", 1500, -60 * 24 * H, 200 * 24 * H),
      lot("20000000-0000-4000-8000-000000000002", 200, -300 * 24 * H, 10 * 24 * H),
      lot("20000000-0000-4000-8000-000000000003", 103, 5 * 24 * H, 370 * 24 * H),
    ],
    points_movements: [
      {
        id: 1,
        user_id: IDS.ava,
        booking_id: null,
        lot_id: null,
        kind: "earn",
        points: 1500,
        created_at: new Date(now - 60 * 24 * H).toISOString(),
      },
      {
        id: 2,
        user_id: IDS.ava,
        booking_id: IDS.bDone,
        lot_id: null,
        kind: "earn",
        points: 103,
        created_at: completedAt,
      },
    ],
    promo_codes: [
      {
        code: "FIRST20",
        kind: "percent",
        value: 2000,
        first_task_only: true,
        max_discount_cents: 3000,
        expires_at: null,
      },
      {
        code: "WELCOME10",
        kind: "fixed",
        value: 1000,
        first_task_only: false,
        max_discount_cents: null,
        expires_at: null,
      },
    ],
    promo_redemptions: [],
    payouts: [],
    tasker_strikes: [],
    disputes: [],
    ledger_txns: [],
    ledger_lines: [],
    tasker_balances: [{ tasker_id: IDS.tara, balance_cents: 7650 }],
  };
}

function b64url(o: unknown): string {
  return Buffer.from(JSON.stringify(o)).toString("base64url");
}

function session(user: Row) {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const access = `${b64url({ alg: "HS256", typ: "JWT" })}.${b64url({ sub: user.id, email: user.email, role: "authenticated", aud: "authenticated", exp, iat: exp - 3600 })}.sig`;
  return {
    access_token: access,
    token_type: "bearer",
    expires_in: 3600,
    expires_at: exp,
    refresh_token: `refresh-${user.id}`,
    user: {
      id: user.id,
      aud: "authenticated",
      role: "authenticated",
      email: user.email,
      app_metadata: { provider: "email" },
      user_metadata: {},
      created_at: new Date().toISOString(),
    },
  };
}

function applyFilters(rows: Row[], params: URLSearchParams): Row[] {
  let out = rows;
  for (const [key, raw] of params.entries()) {
    if (["select", "order", "limit", "offset"].includes(key)) continue;
    const m = /^(eq|neq|in|gte|lte|gt|lt)\.(.*)$/.exec(raw);
    if (!m) continue;
    const [, op, val] = m;
    out = out.filter((r) => {
      const v = r[key];
      const s = v === null || v === undefined ? "null" : String(v);
      switch (op) {
        case "eq":
          return s === val;
        case "neq":
          return s !== val;
        case "in":
          return val
            .replace(/^\(|\)$/g, "")
            .split(",")
            .map((x) => x.replace(/^"|"$/g, ""))
            .includes(s);
        case "gte":
          return s >= val;
        case "lte":
          return s <= val;
        case "gt":
          return s > val;
        case "lt":
          return s < val;
      }
      return true;
    });
  }
  const order = params.get("order");
  if (order) {
    const [col, dir] = order.split(".");
    out = [...out].sort(
      (a, b) =>
        (String(a[col]) < String(b[col]) ? -1 : String(a[col]) > String(b[col]) ? 1 : 0) *
        (dir === "desc" ? -1 : 1),
    );
  }
  const limit = params.get("limit");
  if (limit) out = out.slice(0, Number(limit));
  return out;
}

export interface ApiCall {
  method: string;
  path: string;
  body: unknown;
  headers: Record<string, string>;
}

export interface MockBackend {
  db: Record<string, Row[]>;
  apiCalls: ApiCall[];
  /** Override a response for an api path (regex on the path after /functions/v1/api). */
  onApi: (re: RegExp, handler: (call: ApiCall) => { status?: number; body: unknown }) => void;
}

export async function mockBackend(page: Page, db = makeDb()): Promise<MockBackend> {
  const apiCalls: ApiCall[] = [];
  const handlers: { re: RegExp; handler: (c: ApiCall) => { status?: number; body: unknown } }[] =
    [];
  let currentUser: Row | null = null;

  const json = (
    route: Route,
    status: number,
    body: unknown,
    headers: Record<string, string> = {},
  ) =>
    route.fulfill({
      status,
      contentType: "application/json",
      headers: { "access-control-allow-origin": "*", ...headers },
      body: JSON.stringify(body),
    });

  const cors = (route: Route) =>
    route.fulfill({
      status: 204,
      headers: {
        "access-control-allow-origin": "*",
        "access-control-allow-headers": "*",
        "access-control-allow-methods": "GET,POST,PATCH,DELETE,OPTIONS",
      },
    });

  await page.route("**/auth/v1/**", async (route: Route, req: Request) => {
    if (req.method() === "OPTIONS") return cors(route);
    const url = new URL(req.url());
    if (url.pathname.endsWith("/token")) {
      const body = req.postDataJSON() as { email?: string; password?: string };
      const user = db.profiles.find((p) => p.email === body.email);
      if (!user || body.password !== PASSWORD)
        return json(route, 400, {
          error: "invalid_grant",
          error_description: "Invalid login credentials",
          code: "invalid_credentials",
          msg: "Invalid login credentials",
        });
      currentUser = user;
      return json(route, 200, session(user));
    }
    if (url.pathname.endsWith("/user"))
      return currentUser
        ? json(route, 200, session(currentUser).user)
        : json(route, 401, { msg: "no user" });
    if (url.pathname.endsWith("/logout")) {
      currentUser = null;
      return route.fulfill({ status: 204, headers: { "access-control-allow-origin": "*" } });
    }
    return json(route, 404, {});
  });

  await page.route("**/rest/v1/**", async (route: Route, req: Request) => {
    if (req.method() === "OPTIONS") return cors(route);
    const url = new URL(req.url());
    const table = url.pathname.split("/rest/v1/")[1];
    const rows = applyFilters(db[table] ?? [], url.searchParams);
    const single = (req.headers()["accept"] ?? "").includes("vnd.pgrst.object");
    if (single) {
      if (rows.length === 1) return json(route, 200, rows[0]);
      if (rows.length === 0 && req.headers()["accept"]?.includes("nulls=stripped") === false)
        return json(route, 406, { code: "PGRST116", message: "no rows" });
      return json(
        route,
        rows.length ? 200 : 406,
        rows[0] ?? {
          code: "PGRST116",
          message: "JSON object requested, multiple (or no) rows returned",
          details: "The result contains 0 rows",
        },
      );
    }
    return json(route, 200, rows, {
      "content-range": `0-${Math.max(rows.length - 1, 0)}/${rows.length}`,
    });
  });

  await page.route("**/functions/v1/api/**", async (route: Route, req: Request) => {
    if (req.method() === "OPTIONS") return cors(route);
    const path = new URL(req.url()).pathname.split("/functions/v1/api")[1];
    const call: ApiCall = {
      method: req.method(),
      path,
      body: req.postDataJSON(),
      headers: req.headers(),
    };
    if (path !== "/quote") apiCalls.push(call);
    const h = handlers.find((x) => x.re.test(path));
    if (h) {
      const r = h.handler(call);
      return json(route, r.status ?? 200, r.body);
    }
    if (path === "/quote")
      return json(route, 503, { error: { code: "unavailable", message: "mock: no server quote" } });
    const m = /^\/bookings\/([^/]+)\/(\w[\w-]*)$/.exec(path);
    if (m) {
      const b = db.bookings.find((x) => x.id === m[1]);
      const next: Record<string, string> = {
        accept: "accepted",
        decline: "declined",
        start: "in_progress",
        complete: "completed",
        cancel: "canceled_client",
      };
      if (b && next[m[2]]) b.status = next[m[2]];
      return json(route, 200, { booking: b ?? { id: m[1], status: "unknown" } });
    }
    if (path === "/bookings")
      return json(route, 200, {
        booking: { id: "10000000-0000-4000-8000-00000000beef", status: "requested" },
      });
    return json(route, 200, { ok: true });
  });

  return { db, apiCalls, onApi: (re, handler) => handlers.push({ re, handler }) };
}

export async function signIn(page: Page, email: string) {
  await page.goto("/signin");
  await page.getByTestId("signin-email").fill(email);
  await page.getByTestId("signin-password").fill(PASSWORD);
  await page.getByTestId("signin-submit").click();
}
