// Discovery reads for signed-out visitors and clients: price estimates and tasker availability.
// Public (docs/contracts.md 4.3): nothing here exposes another client, a booking id or a tasker's earnings.

import {
  daySlots,
  inTimeOfDay,
  localParts,
  quote,
  SLOT_HOLDING_STATUSES,
  TIME_OF_DAY,
  TimeOfDay,
} from "../../_shared/domain/index.ts";
import { Db, loadPolicy } from "../../_shared/db.ts";
import { HttpError, optInt, pgToHttp, UUID_RE } from "../../_shared/http.ts";
import { Ctx } from "../context.ts";
import { loadSchedule } from "./bookings.ts";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function queryDate(ctx: Ctx, name: string): string | undefined {
  const v = ctx.query[name];
  if (v === undefined || v === "") return undefined;
  const d = new Date(`${v}T00:00:00Z`);
  if (!DATE_RE.test(v) || Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v)
    throw new HttpError(400, "bad_request", `${name} must be a date, YYYY-MM-DD`);
  return v;
}

function queryInt(ctx: Ctx, name: string, def: number, min: number, max: number): number {
  const raw = ctx.query[name];
  if (raw === undefined || raw === "") return def;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max)
    throw new HttpError(400, "bad_request", `${name} must be an integer ${min}..${max}`);
  return n;
}

// ---- POST /quote/estimate ---------------------------------------------------------------------------------

/** Total price per tasker for a task length, for the cards on the browse pages. No promo, no points. */
export async function quoteEstimate(ctx: Ctx) {
  const ids = ctx.body.taskerIds;
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > 50)
    throw new HttpError(400, "bad_request", "taskerIds must be a list of 1..50 ids");
  for (const id of ids)
    if (typeof id !== "string" || !UUID_RE.test(id))
      throw new HttpError(400, "bad_request", "taskerIds must be uuids");
  const minutes = optInt(ctx.body, "minutes", 1);
  if (minutes === undefined || minutes > 24 * 60)
    throw new HttpError(400, "bad_request", "minutes must be an integer 1..1440");
  const policy = await loadPolicy(ctx.db, undefined, ctx.now);
  const { data, error } = await ctx.db
    .from("taskers")
    .select("id, hourly_rate_cents")
    .eq("status", "active")
    .in(
      "id",
      ids.map((i) => (i as string).toLowerCase()),
    );
  if (error) throw pgToHttp(error);
  const rate = new Map((data ?? []).map((t) => [t.id as string, Number(t.hourly_rate_cents)]));
  return {
    estimates: (ids as string[])
      .map((i) => i.toLowerCase())
      .filter((i) => rate.has(i))
      .map((taskerId) => ({
        taskerId,
        totalCents: quote(rate.get(taskerId)!, minutes, policy).total,
        policyVersion: policy.version,
      })),
  };
}

// ---- Availability -------------------------------------------------------------------------------------------

/** Bookings that hold the tasker's time in [from, to], as bare intervals (no client, no ids). */
async function busyIntervals(db: Db, taskerId: string, from: Date, to: Date) {
  const { data, error } = await db
    .from("bookings")
    .select("start_at, est_minutes")
    .eq("tasker_id", taskerId)
    .in("status", SLOT_HOLDING_STATUSES)
    .gte("start_at", new Date(from.getTime() - 24 * 3_600_000).toISOString())
    .lte("start_at", to.toISOString());
  if (error) throw pgToHttp(error);
  return (data ?? []).map((r) => {
    const startAt = new Date(r.start_at as string);
    return { startAt, endAt: new Date(startAt.getTime() + Number(r.est_minutes) * 60_000) };
  });
}

// GET /taskers/:id/availability?from=YYYY-MM-DD&days=14&minutes=60
export async function taskerAvailability(ctx: Ctx) {
  const taskerId = ctx.params.id;
  const { data: t, error } = await ctx.db
    .from("taskers")
    .select("id")
    .eq("id", taskerId)
    .eq("status", "active")
    .maybeSingle();
  if (error) throw pgToHttp(error);
  if (!t) throw new HttpError(404, "not_found", "tasker not found");
  const days = queryInt(ctx, "days", 14, 1, 31);
  const minutes = queryInt(ctx, "minutes", 60, 1, 24 * 60);
  const sch = await loadSchedule(ctx.db, taskerId);
  const from = queryDate(ctx, "from") ?? localParts(ctx.now, sch.tz).date;
  const fromAt = new Date(`${from}T00:00:00Z`);
  const toAt = new Date(fromAt.getTime() + (days + 1) * 86_400_000);
  const sched = await loadSchedule(ctx.db, taskerId, { from: fromAt, to: toAt });
  const busy = await busyIntervals(ctx.db, taskerId, fromAt, toAt);
  const out = daySlots({
    tz: sched.tz,
    fromDate: from,
    days,
    minutes,
    now: ctx.now,
    rules: sched.rules,
    overrides: sched.overrides,
    busy,
  });
  return {
    tz: sched.tz,
    minutes,
    days: out.map((d) => ({
      date: d.date,
      slots: d.slots.map((s) => ({
        start: s.start,
        startAt: s.startAt.toISOString(),
        status: s.status,
      })),
    })),
  };
}

// GET /taskers/availability?category=slug&date=YYYY-MM-DD&timeOfDay=morning&minutes=60
// The first free slot of the day for every active tasker in the category (what the filters on the list page ask).
export async function availabilityByCategory(ctx: Ctx) {
  const category = ctx.query.category;
  if (!category) throw new HttpError(400, "bad_request", "category is required");
  const tod = ctx.query.timeOfDay as TimeOfDay | undefined;
  if (tod !== undefined && !Object.hasOwn(TIME_OF_DAY, tod))
    throw new HttpError(400, "bad_request", "timeOfDay must be morning, afternoon or evening");
  const minutes = queryInt(ctx, "minutes", 60, 1, 24 * 60);
  const { data: cat, error: e0 } = await ctx.db
    .from("categories")
    .select("slug, name")
    .eq("slug", category)
    .eq("active", true)
    .maybeSingle();
  if (e0) throw pgToHttp(e0);
  if (!cat) throw new HttpError(404, "not_found", "unknown category");
  const { data: taskers, error: e1 } = await ctx.db
    .from("taskers")
    .select("id, category")
    .eq("status", "active")
    .order("id");
  if (e1) throw pgToHttp(e1);
  const mine = (taskers ?? []).filter((t) => {
    const c = String(t.category).toLowerCase();
    return c === cat.slug || c === String(cat.name).toLowerCase();
  });
  const date = queryDate(ctx, "date");
  const results = [];
  for (const t of mine) {
    const sch = await loadSchedule(ctx.db, t.id as string);
    const day = date ?? localParts(ctx.now, sch.tz).date;
    const dayStart = new Date(`${day}T00:00:00Z`);
    const dayEnd = new Date(dayStart.getTime() + 2 * 86_400_000);
    const sched = await loadSchedule(ctx.db, t.id as string, { from: dayStart, to: dayEnd });
    const busy = await busyIntervals(ctx.db, t.id as string, dayStart, dayEnd);
    const [d] = daySlots({
      tz: sched.tz,
      fromDate: day,
      days: 1,
      minutes,
      now: ctx.now,
      rules: sched.rules,
      overrides: sched.overrides,
      busy,
    });
    const first = d.slots.find((s) => s.status === "free" && (!tod || inTimeOfDay(s, tod)));
    results.push({
      taskerId: t.id as string,
      date: day,
      firstSlot: first ? { start: first.start, startAt: first.startAt.toISOString() } : null,
    });
  }
  return { category: cat.slug, minutes, ...(tod ? { timeOfDay: tod } : {}), taskers: results };
}
