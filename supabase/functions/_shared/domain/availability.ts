// Tasker availability: weekly rules, minus blocked dates, plus added windows, minus existing bookings.
// Times are the tasker's wall clock (`tz`). A tasker with no weekly rules at all is open all day, every day
// (the legacy behaviour; nothing is enforced until the tasker sets a schedule).

import { addLocalDays, localParts, localToUtc } from "./time.ts";

export interface AvailabilityRule {
  weekday: number; // 0 = Sunday
  startMinute: number;
  endMinute: number;
}

export interface AvailabilityOverride {
  date: string; // YYYY-MM-DD in the tasker's tz
  kind: "block" | "add";
  startMinute: number;
  endMinute: number;
}

export interface BusyInterval {
  startAt: Date;
  endAt: Date;
}

export type SlotStatus = "free" | "taken" | "unavailable";

export interface Slot {
  /** Local start, "YYYY-MM-DDTHH:mm" (what POST /bookings takes as localStart together with the tz). */
  start: string;
  startAt: Date;
  status: SlotStatus;
}

export interface DaySlots {
  date: string;
  slots: Slot[];
}

interface Window {
  start: number;
  end: number;
}

const DAY_MINUTES = 1440;

function merge(ws: Window[]): Window[] {
  const sorted = ws.filter((w) => w.end > w.start).sort((a, b) => a.start - b.start);
  const out: Window[] = [];
  for (const w of sorted) {
    const last = out[out.length - 1];
    if (last && w.start <= last.end) last.end = Math.max(last.end, w.end);
    else out.push({ ...w });
  }
  return out;
}

function subtract(ws: Window[], cut: Window): Window[] {
  const out: Window[] = [];
  for (const w of ws) {
    if (cut.end <= w.start || cut.start >= w.end) {
      out.push(w);
      continue;
    }
    if (cut.start > w.start) out.push({ start: w.start, end: cut.start });
    if (cut.end < w.end) out.push({ start: cut.end, end: w.end });
  }
  return out;
}

/** The working windows (minutes since local midnight) of one local date. */
export function dayWindows(
  date: string,
  rules: AvailabilityRule[],
  overrides: AvailabilityOverride[],
): Window[] {
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  let ws: Window[] =
    rules.length === 0
      ? [{ start: 0, end: DAY_MINUTES }]
      : rules
          .filter((r) => r.weekday === weekday)
          .map((r) => ({ start: r.startMinute, end: r.endMinute }));
  const today = overrides.filter((o) => o.date === date);
  for (const o of today.filter((x) => x.kind === "add"))
    ws.push({ start: o.startMinute, end: o.endMinute });
  ws = merge(ws);
  for (const o of today.filter((x) => x.kind === "block"))
    ws = subtract(ws, { start: o.startMinute, end: o.endMinute });
  return merge(ws);
}

export interface SlotQuery {
  tz: string;
  fromDate: string; // first local date, YYYY-MM-DD
  days: number;
  minutes: number; // task length
  now: Date;
  rules: AvailabilityRule[];
  overrides: AvailabilityOverride[];
  busy: BusyInterval[];
  /** Spacing of start times. Default 30. */
  stepMinutes?: number;
  /** A start earlier than now + this is "unavailable". Default 60. */
  minLeadMinutes?: number;
}

/**
 * Candidate start times for each local day: every `stepMinutes` inside a working window.
 *  - `free`: the whole task fits in the window, is not in the past and does not overlap another booking
 *  - `taken`: it fits but overlaps another booking
 *  - `unavailable`: the task would run past the end of the window, or it starts too soon
 * Starts outside every window are not listed.
 */
export function daySlots(q: SlotQuery): DaySlots[] {
  const step = q.stepMinutes ?? 30;
  const lead = (q.minLeadMinutes ?? 60) * 60_000;
  const out: DaySlots[] = [];
  for (let i = 0; i < q.days; i++) {
    const date = addLocalDays(q.fromDate, i);
    const slots: Slot[] = [];
    for (const w of dayWindows(date, q.rules, q.overrides)) {
      const first = Math.ceil(w.start / step) * step;
      for (let t = first; t < w.end && t < DAY_MINUTES; t += step) {
        const hh = String(Math.floor(t / 60)).padStart(2, "0");
        const mm = String(t % 60).padStart(2, "0");
        const start = `${date}T${hh}:${mm}`;
        const startAt = localToUtc(start, q.tz);
        const endAt = new Date(startAt.getTime() + q.minutes * 60_000);
        let status: SlotStatus;
        if (t + q.minutes > w.end || startAt.getTime() < q.now.getTime() + lead) {
          status = "unavailable";
        } else if (q.busy.some((b) => b.startAt < endAt && b.endAt > startAt)) {
          status = "taken";
        } else {
          status = "free";
        }
        slots.push({ start, startAt, status });
      }
    }
    out.push({ date, slots });
  }
  return out;
}

/** True when the task [startAt, startAt + minutes) lies wholly inside one of the tasker's working windows. */
export function fitsSchedule(
  startAt: Date,
  minutes: number,
  tz: string,
  rules: AvailabilityRule[],
  overrides: AvailabilityOverride[],
): boolean {
  const { date, minuteOfDay } = localParts(startAt, tz);
  return dayWindows(date, rules, overrides).some(
    (w) => minuteOfDay >= w.start && minuteOfDay + minutes <= w.end,
  );
}

/** Time-of-day filters used by discovery (local hour of the start). */
export const TIME_OF_DAY = {
  morning: { from: 8 * 60, to: 12 * 60 },
  afternoon: { from: 12 * 60, to: 17 * 60 },
  evening: { from: 17 * 60, to: 21 * 60 },
} as const;
export type TimeOfDay = keyof typeof TIME_OF_DAY;

export function inTimeOfDay(slot: Slot, tod: TimeOfDay): boolean {
  const [h, m] = slot.start.slice(11).split(":").map(Number);
  const mins = h * 60 + m;
  return mins >= TIME_OF_DAY[tod].from && mins < TIME_OF_DAY[tod].to;
}
