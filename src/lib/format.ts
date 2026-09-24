import { formatCents } from "@domain";

export { formatCents };

export const money = (c: number | null | undefined) => formatCents(Number(c ?? 0));

export function bps(b: number): string {
  const pct = b / 100;
  return `${Number.isInteger(pct) ? pct : pct.toFixed(2)}%`;
}

/** Parse a dollar string ("12.34", "$5", "5.5") into integer cents without float math. */
export function parseDollars(input: string): number | null {
  const s = input.trim().replace(/^\$/, "").replace(/,/g, "");
  const m = /^(\d+)(?:\.(\d{0,2}))?$/.exec(s);
  if (!m) return null;
  return Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0") || "0");
}

export function fmtDateTime(iso: string | Date, tz?: string): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: tz,
    timeZoneName: tz ? "short" : undefined,
  }).format(d);
}

export function fmtDate(iso: string | Date): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(d);
}

export function fmtMinutes(m: number): string {
  const h = Math.floor(m / 60),
    r = m % 60;
  return h && r ? `${h}h ${r}m` : h ? `${h}h` : `${r}m`;
}

export function statusLabel(s: string): string {
  return s.replace(/_/g, " ");
}
