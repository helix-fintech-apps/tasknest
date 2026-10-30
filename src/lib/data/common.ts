// Read-side queries via supabase-js under RLS. No joins/embeds on purpose: each table is read
// separately so RLS on one table (e.g. profiles) can't hide rows of another.

import { supabase } from "../supabase";

export function check<T>(res: { data: T | null; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return (res.data ?? ([] as unknown)) as T;
}

/**
 * Public names from `display_names` (id, display_name): a tasker's full name, everyone else's first
 * name only. RLS shows a row to the user themself, staff, anyone for active taskers, and the other
 * party of a shared booking. `profiles` is private (own row and staff), so it is never used for names.
 */
export async function namesFor(ids: string[]): Promise<Map<string, string>> {
  const uniq = [...new Set(ids)].filter(Boolean);
  if (!uniq.length) return new Map();
  const res = await supabase.from("display_names").select("id, display_name").in("id", uniq);
  // Names hidden by RLS (or a read error) fall back to a generic label at the call site.
  if (res.error) return new Map();
  return new Map(
    (res.data as { id: string; display_name: string }[])
      .filter((r) => r.display_name?.trim())
      .map((r) => [r.id, r.display_name.trim()]),
  );
}
