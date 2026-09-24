// TaskNest `api` Edge Function. See docs/API.md.
//
// Auth: the caller's Supabase JWT (Authorization: Bearer ...) identifies the user; all writes use the
// service role. Every mutating endpoint honors an Idempotency-Key header (replays return the first
// response). Money rules come from ../_shared/domain (the same code the UI and unit tests use).

import {
  corsHeaders,
  errorBody,
  HttpError,
  json,
  readJson,
  sha256Hex,
  toHttpError,
  TRANSIENT_CODES,
  UUID_RE,
} from "../_shared/http.ts";
import { Db, env, serviceClient, userClient } from "../_shared/db.ts";
import { PaymentError, PaymentsProvider, selectProvider } from "../_shared/provider/index.ts";
import { handleStripeWebhook } from "../_shared/stripe-webhook.ts";
import { Caller, Ctx, Role } from "./context.ts";
import { verifyTestClockToken } from "./test-clock.ts";
import * as bookings from "./handlers/bookings.ts";
import * as money from "./handlers/money.ts";
import * as admin from "./handlers/admin.ts";

export const BUILD = "tasknest-api 2026-09-24.3";

type Handler = (ctx: Ctx) => Promise<unknown>;
interface Route {
  method: "GET" | "POST";
  pattern: RegExp;
  handler: Handler;
  /** Stores the response under the caller's Idempotency-Key (mutations). */
  idempotent: boolean;
}

const ID = "([0-9a-fA-F-]{36})";
const booking = (action: string) => new RegExp(`^/bookings/${ID}/${action}$`);
const routes: Route[] = [
  { method: "POST", pattern: /^\/quote$/, handler: bookings.quoteHandler, idempotent: false },
  { method: "POST", pattern: /^\/bookings$/, handler: bookings.createBooking, idempotent: true },
  { method: "POST", pattern: booking("accept"), handler: bookings.accept, idempotent: true },
  { method: "POST", pattern: booking("decline"), handler: bookings.decline, idempotent: true },
  {
    method: "POST",
    pattern: booking("reschedule"),
    handler: bookings.reschedule,
    idempotent: true,
  },
  {
    method: "GET",
    pattern: booking("cancel-preview"),
    handler: bookings.cancelPreview,
    idempotent: false,
  },
  { method: "POST", pattern: booking("cancel"), handler: bookings.cancel, idempotent: true },
  { method: "POST", pattern: booking("no-show"), handler: bookings.noShow, idempotent: true },
  { method: "POST", pattern: booking("start"), handler: bookings.start, idempotent: true },
  { method: "POST", pattern: booking("complete"), handler: bookings.complete, idempotent: true },
  { method: "POST", pattern: booking("tip"), handler: money.tip, idempotent: true },
  {
    method: "POST",
    pattern: booking("refund-preview"),
    handler: money.refundPreview,
    idempotent: false,
  },
  { method: "POST", pattern: booking("refund"), handler: money.refund, idempotent: true },
  { method: "POST", pattern: booking("review"), handler: money.review, idempotent: true },
  { method: "POST", pattern: /^\/payouts\/run$/, handler: admin.runPayouts, idempotent: true },
  {
    method: "POST",
    pattern: new RegExp(`^/admin/taskers/${ID}/status$`),
    handler: admin.setTaskerStatus,
    idempotent: true,
  },
  {
    method: "POST",
    pattern: /^\/admin\/policies$/,
    handler: admin.publishPolicy,
    idempotent: true,
  },
  {
    method: "POST",
    pattern: /^\/admin\/disputes\/simulate$/,
    handler: admin.simulateDispute,
    idempotent: true,
  },
  {
    method: "POST",
    pattern: /^\/admin\/points\/grant$/,
    handler: admin.grantPoints,
    idempotent: true,
  },
  { method: "POST", pattern: /^\/admin\/test-clock$/, handler: admin.testClock, idempotent: false },
];

let providerSingleton: PaymentsProvider | null = null;
function provider(): PaymentsProvider {
  if (!providerSingleton) {
    try {
      providerSingleton = selectProvider({
        PAYMENTS_PROVIDER: env("PAYMENTS_PROVIDER"),
        STRIPE_SECRET_KEY: env("STRIPE_SECRET_KEY"),
      });
    } catch (e) {
      // e.g. a live Stripe key: refuse to move money at all.
      throw new HttpError(503, "payments_misconfigured", (e as Error).message);
    }
  }
  return providerSingleton;
}

/** Scheduled jobs (cron) call with the function's own service-role key; they may only run payouts. */
const SYSTEM_USER_ID = "00000000-0000-0000-0000-000000000000";
const SYSTEM_ROUTES = new Set(["/payouts/run"]);

/** Strip the function prefix: "/api/bookings" or "/functions/v1/api/bookings" -> "/bookings". */
export function routePath(pathname: string): string {
  const m = pathname.match(/^(?:\/functions\/v1)?\/api(\/.*)?$/);
  const p = m ? (m[1] ?? "/") : pathname;
  return p.length > 1 ? p.replace(/\/+$/, "") : p;
}

async function authenticate(req: Request, db: Db): Promise<Caller> {
  const auth = req.headers.get("Authorization") ?? "";
  const token = auth.replace(/^Bearer\s+/i, "");
  if (!token) throw new HttpError(401, "unauthorized", "missing Authorization bearer token");
  const serviceKey = env("SUPABASE_SERVICE_ROLE_KEY");
  if (serviceKey && token === serviceKey) {
    return {
      id: SYSTEM_USER_ID,
      email: "system",
      role: "admin",
      emailConfirmed: true,
      system: true,
    };
  }
  const { data, error } = await userClient(auth).auth.getUser(token);
  if (error || !data?.user) throw new HttpError(401, "unauthorized", "invalid or expired session");
  const { data: profile } = await db
    .from("profiles")
    .select("role")
    .eq("id", data.user.id)
    .maybeSingle();
  if (!profile) throw new HttpError(403, "no_profile", "user has no profile");
  return {
    id: data.user.id,
    email: data.user.email ?? "",
    role: profile.role as Role,
    emailConfirmed: !!data.user.email_confirmed_at,
  };
}

// ---- Idempotency ---------------------------------------------------------------------------------

async function idemBegin(
  db: Db,
  userId: string,
  key: string,
  method: string,
  path: string,
  hash: string,
  attempt = 0,
): Promise<Response | null> {
  const ins = await db
    .from("idempotency_keys")
    .insert({ user_id: userId, key, method, path, request_hash: hash });
  if (!ins.error) return null;
  if (ins.error.code !== "23505" || attempt > 2) throw toHttpError(ins.error);
  const { data: row } = await db
    .from("idempotency_keys")
    .select("*")
    .eq("user_id", userId)
    .eq("key", key)
    .maybeSingle();
  if (!row) return idemBegin(db, userId, key, method, path, hash, attempt + 1);
  if (row.request_hash !== hash || row.path !== path) {
    return json(
      errorBody("idempotency_key_reused", "this Idempotency-Key was used for a different request"),
      422,
    );
  }
  if (row.status === "done") {
    return json(row.response_body, row.response_status, { "Idempotent-Replayed": "true" });
  }
  // A request that crashed mid-flight releases its key after 60s.
  if (Date.now() - new Date(row.updated_at).getTime() > 60_000) {
    await db
      .from("idempotency_keys")
      .delete()
      .eq("user_id", userId)
      .eq("key", key)
      .eq("status", "in_progress");
    return idemBegin(db, userId, key, method, path, hash, attempt + 1);
  }
  return json(
    errorBody(
      "request_in_progress",
      "a request with this Idempotency-Key is still being processed",
    ),
    409,
  );
}

async function idemFinish(
  db: Db,
  userId: string,
  key: string,
  status: number,
  body: unknown,
  code?: string,
) {
  if (status >= 500 || (code && TRANSIENT_CODES.has(code))) {
    // Nothing was committed: let a retry with the same key run again.
    await db.from("idempotency_keys").delete().eq("user_id", userId).eq("key", key);
  } else {
    await db
      .from("idempotency_keys")
      .update({
        status: "done",
        response_status: status,
        response_body: body,
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", userId)
      .eq("key", key);
  }
}

// ---- Entry point ---------------------------------------------------------------------------------

function findRoute(method: string, path: string): { route: Route; match: RegExpMatchArray } {
  for (const r of routes) {
    const m = path.match(r.pattern);
    if (m && r.method === method) return { route: r, match: m };
  }
  const known = routes.some((r) => r.pattern.test(path));
  throw new HttpError(
    known ? 405 : 404,
    known ? "method_not_allowed" : "not_found",
    `${method} ${path} is not an endpoint`,
  );
}

async function requestClock(
  req: Request,
  prov: PaymentsProvider,
  userId: string,
): Promise<{ now: Date; testNow: string | null }> {
  const testNow = req.headers.get("x-test-now");
  if (!testNow) return { now: new Date(), testNow: null };
  if (prov.name !== "fake")
    throw new HttpError(
      400,
      "test_clock_disabled",
      "x-test-now is only honored with the fake provider",
    );
  const token = req.headers.get("x-test-clock") ?? "";
  if (!(await verifyTestClockToken(token, userId, Math.floor(Date.now() / 1000)))) {
    throw new HttpError(
      403,
      "test_clock_forbidden",
      "x-test-now needs a valid x-test-clock token (POST /admin/test-clock)",
    );
  }
  const now = new Date(testNow);
  if (Number.isNaN(now.getTime()))
    throw new HttpError(400, "bad_request", "x-test-now must be an ISO timestamp");
  return { now, testNow };
}

export async function handle(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const url = new URL(req.url);
  const path = routePath(url.pathname);
  let db: Db;
  try {
    db = serviceClient();
  } catch (e) {
    const h = toHttpError(e);
    return json(errorBody(h.code, h.message), h.status);
  }

  // Stripe calls this without a user JWT; it is authenticated by its signature instead. (Deployed, the
  // `api` function requires a JWT, so Stripe must use the `stripe-webhook` function; this is for local use.)
  if (path === "/webhooks/stripe" && req.method === "POST") return handleStripeWebhook(req, db);
  if (path === "/health" || path === "/") {
    let providerName: string;
    try {
      providerName = provider().name;
    } catch (e) {
      providerName = `error: ${(e as Error).message}`;
    }
    return json({ ok: true, service: "tasknest-api", build: BUILD, provider: providerName });
  }

  let userId = "";
  let idemKey: string | undefined;
  let status: number;
  let body: unknown;
  let errorCode: string | undefined;
  try {
    const { route, match } = findRoute(req.method, path);
    const reqBody = req.method === "POST" ? await readJson(req) : {};
    const caller = await authenticate(req, db);
    if (caller.system && !SYSTEM_ROUTES.has(path)) {
      throw new HttpError(403, "forbidden", "the service key may only call /payouts/run");
    }
    userId = caller.id;
    const prov = provider();
    const { now, testNow } = await requestClock(req, prov, caller.id);

    const params: Record<string, string> = {};
    if (match[1]) {
      if (!UUID_RE.test(match[1])) throw new HttpError(400, "bad_request", "id must be a uuid");
      params.id = match[1].toLowerCase();
    }

    idemKey = route.idempotent ? (req.headers.get("Idempotency-Key") ?? undefined) : undefined;
    if (idemKey !== undefined && (idemKey.length < 8 || idemKey.length > 200)) {
      idemKey = undefined;
      throw new HttpError(400, "bad_request", "Idempotency-Key must be 8..200 characters");
    }
    if (idemKey) {
      const hash = await sha256Hex(
        `${req.method} ${path} ${JSON.stringify(reqBody)} ${testNow ?? ""}`,
      );
      const replay = await idemBegin(db, userId, idemKey, req.method, path, hash);
      if (replay) return replay;
    }

    const ctx: Ctx = {
      db,
      provider: prov,
      now,
      user: caller,
      idemKey,
      body: reqBody,
      params,
      opKey: idemKey ? `req:${userId}:${idemKey}` : `op:${crypto.randomUUID()}`,
    };
    body = await route.handler(ctx);
    const requested = (body as { requested?: boolean } | null)?.requested === true;
    status = req.method === "POST" && path === "/bookings" ? 201 : requested ? 202 : 200;
  } catch (e) {
    const h =
      e instanceof PaymentError ? new HttpError(e.httpStatus, e.code, e.message) : toHttpError(e);
    if (h.status >= 500) console.error("api error", path, h.code, h.message, e);
    status = h.status;
    errorCode = h.code;
    body = errorBody(h.code, h.message, h.details);
  }
  if (idemKey && userId) {
    try {
      await idemFinish(db, userId, idemKey, status, body, errorCode);
    } catch (e) {
      console.error("idempotency store failed", e);
    }
  }
  return json(body, status);
}

const D = (globalThis as { Deno?: { serve?: (h: (req: Request) => Promise<Response>) => unknown } })
  .Deno;
if (D?.serve) D.serve(handle);
