// Time helpers. Task times are entered in the task location's time zone and stored in UTC.

const MS_HOUR = 3_600_000;
const MS_DAY = 86_400_000;

/** Offset (minutes) of `tz` from UTC at the given instant. */
function tzOffsetMinutes(instant: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  const asUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
    get("second"),
  );
  return Math.round((asUtc - instant.getTime()) / 60_000);
}

/**
 * Convert a wall-clock time in `tz` (e.g. "2026-11-01T09:00") to a UTC Date.
 * Handles daylight-saving transitions by re-checking the offset at the result.
 */
export function localToUtc(localIso: string, tz: string): Date {
  const [d, t] = localIso.split("T");
  const [y, mo, da] = d.split("-").map(Number);
  const [h, mi] = (t ?? "00:00").split(":").map(Number);
  const guess = Date.UTC(y, mo - 1, da, h, mi);
  const offset = tzOffsetMinutes(new Date(guess), tz);
  let result = guess - offset * 60_000;
  const offset2 = tzOffsetMinutes(new Date(result), tz);
  if (offset2 !== offset) result = guess - offset2 * 60_000;
  return new Date(result);
}

export function hoursBetween(from: Date, to: Date): number {
  return (to.getTime() - from.getTime()) / MS_HOUR;
}

export function addDays(d: Date, days: number): Date {
  return new Date(d.getTime() + days * MS_DAY);
}

export function addMonths(d: Date, months: number): Date {
  const r = new Date(d.getTime());
  r.setUTCMonth(r.getUTCMonth() + months);
  return r;
}
