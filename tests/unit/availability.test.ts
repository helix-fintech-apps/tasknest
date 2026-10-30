import {
  daySlots,
  dayWindows,
  fitsSchedule,
  inTimeOfDay,
  localParts,
  type AvailabilityOverride,
  type AvailabilityRule,
} from "../../supabase/functions/_shared/domain/index.ts";

const TZ = "America/Los_Angeles";
// Mon-Fri 9:00-17:00
const weekdays: AvailabilityRule[] = [1, 2, 3, 4, 5].map((weekday) => ({
  weekday,
  startMinute: 9 * 60,
  endMinute: 17 * 60,
}));
const long = new Date("2026-01-01T00:00:00Z"); // "now" far in the past: lead time never matters

describe("dayWindows", () => {
  it("applies the weekly rule to the weekday", () => {
    expect(dayWindows("2026-11-02", weekdays, [])).toEqual([{ start: 540, end: 1020 }]); // Monday
    expect(dayWindows("2026-11-01", weekdays, [])).toEqual([]); // Sunday
  });

  it("no rules at all means open all day", () => {
    expect(dayWindows("2026-11-01", [], [])).toEqual([{ start: 0, end: 1440 }]);
  });

  it("blocks cut windows, adds extend or create them", () => {
    const ov: AvailabilityOverride[] = [
      { date: "2026-11-02", kind: "block", startMinute: 12 * 60, endMinute: 13 * 60 },
      { date: "2026-11-02", kind: "add", startMinute: 18 * 60, endMinute: 20 * 60 },
      { date: "2026-11-01", kind: "add", startMinute: 10 * 60, endMinute: 12 * 60 }, // a Sunday
    ];
    expect(dayWindows("2026-11-02", weekdays, ov)).toEqual([
      { start: 540, end: 720 },
      { start: 780, end: 1020 },
      { start: 1080, end: 1200 },
    ]);
    expect(dayWindows("2026-11-01", weekdays, ov)).toEqual([{ start: 600, end: 720 }]);
  });

  it("a block on an all-day tasker leaves the rest of the day", () => {
    const ov: AvailabilityOverride[] = [
      { date: "2026-11-03", kind: "block", startMinute: 0, endMinute: 480 },
    ];
    expect(dayWindows("2026-11-03", [], ov)).toEqual([{ start: 480, end: 1440 }]);
  });
});

describe("daySlots", () => {
  const base = { tz: TZ, minutes: 120, now: long, rules: weekdays, overrides: [], busy: [] };

  it("lists half-hour starts inside the window; a task that would overrun the end is unavailable", () => {
    const [mon] = daySlots({ ...base, fromDate: "2026-11-02", days: 1 });
    expect(mon.slots[0].start).toBe("2026-11-02T09:00");
    const byStart = new Map(mon.slots.map((s) => [s.start.slice(11), s.status]));
    expect(byStart.get("09:00")).toBe("free");
    expect(byStart.get("15:00")).toBe("free"); // ends exactly 17:00
    expect(byStart.get("15:30")).toBe("unavailable"); // would end 17:30
    expect(byStart.get("16:30")).toBe("unavailable");
    expect(byStart.has("17:00")).toBe(false); // outside the window: not listed
    expect(byStart.has("08:30")).toBe(false);
  });

  it("marks starts that overlap an existing booking as taken, without saying whose", () => {
    const busyStart = new Date("2026-11-02T18:00:00Z"); // 10:00 PST
    const [mon] = daySlots({
      ...base,
      fromDate: "2026-11-02",
      days: 1,
      busy: [{ startAt: busyStart, endAt: new Date(busyStart.getTime() + 60 * 60_000) }],
    });
    const byStart = new Map(mon.slots.map((s) => [s.start.slice(11), s.status]));
    expect(byStart.get("08:30")).toBeUndefined();
    expect(byStart.get("09:00")).toBe("taken"); // 9-11 overlaps 10-11
    expect(byStart.get("10:30")).toBe("taken");
    expect(byStart.get("11:00")).toBe("free"); // 11-13 starts when the booking ends
    expect(JSON.stringify(mon)).not.toMatch(/client|tasker|booking/);
  });

  it("treats starts inside the lead time as unavailable", () => {
    const now = new Date("2026-11-02T17:00:00Z"); // 09:00 PST Monday
    const [mon] = daySlots({ ...base, now, fromDate: "2026-11-02", days: 1, minutes: 60 });
    const byStart = new Map(mon.slots.map((s) => [s.start.slice(11), s.status]));
    expect(byStart.get("09:00")).toBe("unavailable");
    expect(byStart.get("09:30")).toBe("unavailable"); // less than 60 minutes ahead
    expect(byStart.get("10:00")).toBe("free");
  });

  it("converts local starts to UTC across the daylight-saving change", () => {
    const days = daySlots({ ...base, fromDate: "2026-11-01", days: 3, minutes: 60 });
    const first = (d: string) => days.find((x) => x.date === d)!.slots[0]?.startAt.toISOString();
    expect(days[0].slots).toHaveLength(0); // Sunday
    expect(first("2026-11-02")).toBe("2026-11-02T17:00:00.000Z"); // 09:00 PST = 17:00Z (DST ended Nov 1)
    const spring = daySlots({ ...base, fromDate: "2027-03-12", days: 4, minutes: 60 });
    const f = (d: string) => spring.find((x) => x.date === d)!.slots[0]?.startAt.toISOString();
    expect(f("2027-03-12")).toBe("2027-03-12T17:00:00.000Z"); // Friday, PST
    expect(f("2027-03-15")).toBe("2027-03-15T16:00:00.000Z"); // Monday after spring-forward, PDT
  });

  it("returns one entry per day, even empty ones", () => {
    const days = daySlots({ ...base, fromDate: "2026-11-06", days: 14 });
    expect(days).toHaveLength(14);
    expect(days[0].date).toBe("2026-11-06");
    expect(days[13].date).toBe("2026-11-19");
  });
});

describe("fitsSchedule (what POST /bookings checks)", () => {
  it("accepts a task inside a window and rejects one that crosses its end or the day off", () => {
    const mon10 = new Date("2026-11-02T18:00:00Z"); // 10:00 PST
    expect(fitsSchedule(mon10, 120, TZ, weekdays, [])).toBe(true);
  });

  it("checks the end boundary exactly", () => {
    const at16 = new Date("2026-11-03T00:00:00Z"); // 16:00 PST Monday
    expect(fitsSchedule(at16, 60, TZ, weekdays, [])).toBe(true);
    expect(fitsSchedule(at16, 61, TZ, weekdays, [])).toBe(false);
    expect(fitsSchedule(new Date("2026-11-01T18:00:00Z"), 60, TZ, weekdays, [])).toBe(false); // Sunday
  });

  it("is always true for a tasker with no schedule, even for a task that runs past midnight", () => {
    expect(fitsSchedule(new Date("2026-11-01T11:00:00Z"), 600, TZ, [], [])).toBe(true);
    const lateNight = new Date("2026-11-02T06:30:00Z"); // 23:30 PDT/PST the evening before
    expect(fitsSchedule(lateNight, 180, TZ, [], [])).toBe(true);
    // ...but a date with a block override is a scheduled date: windows end at midnight
    const ov: AvailabilityOverride[] = [
      { date: "2026-11-01", kind: "block", startMinute: 0, endMinute: 60 },
    ];
    expect(fitsSchedule(lateNight, 180, TZ, [], ov)).toBe(false);
  });
});

describe("time-of-day filters and local parts", () => {
  it("buckets a slot by its local start", () => {
    const slot = (start: string) => ({ start, startAt: new Date(), status: "free" as const });
    expect(inTimeOfDay(slot("2026-11-02T08:00"), "morning")).toBe(true);
    expect(inTimeOfDay(slot("2026-11-02T12:00"), "morning")).toBe(false);
    expect(inTimeOfDay(slot("2026-11-02T12:00"), "afternoon")).toBe(true);
    expect(inTimeOfDay(slot("2026-11-02T17:00"), "evening")).toBe(true);
    expect(inTimeOfDay(slot("2026-11-02T21:00"), "evening")).toBe(false);
  });

  it("localParts gives the wall clock date, minute and weekday", () => {
    expect(localParts(new Date("2026-11-02T01:30:00Z"), TZ)).toEqual({
      date: "2026-11-01",
      minuteOfDay: 17 * 60 + 30,
      weekday: 0,
    });
  });
});
