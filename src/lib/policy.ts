import { useEffect, useState } from "react";
import { DEFAULT_POLICY, type MoneyPolicy } from "@domain";
import { supabase, type PolicyRow } from "./supabase";

export interface PolicyState {
  policies: Map<number, PolicyRow>;
  /** The policy in effect right now (see pickActive). */
  active: PolicyRow | null;
  loading: boolean;
  error: string | null;
}

let cache: Promise<PolicyRow[]> | null = null;

/** A row's policy document, with `version` taken from the row (the column is authoritative). */
function normalize(row: PolicyRow): PolicyRow {
  return { ...row, policy: { ...row.policy, version: row.version } };
}

export function fetchPolicies(force = false): Promise<PolicyRow[]> {
  if (!cache || force) {
    cache = Promise.resolve(
      supabase
        .from("money_policies")
        .select("version, policy, effective_from")
        .order("version", { ascending: true }),
    ).then(({ data, error }) => {
      if (error) {
        cache = null;
        throw new Error(error.message);
      }
      return ((data ?? []) as PolicyRow[]).map(normalize);
    });
  }
  return cache;
}

/**
 * The policy in effect at `now`, chosen by `effective_from`: only versions whose effective_from has
 * passed are candidates, and among those the highest version wins (the rule the API uses for new
 * quotes and bookings). A version published for the future (for example one effective 2099-12-31)
 * is never active before its date, whatever its version number. Existing bookings never use this:
 * they are always evaluated with their own `policy_version`.
 */
export function pickActive(rows: PolicyRow[], now: Date = new Date()): PolicyRow | null {
  let best: PolicyRow | null = null;
  for (const r of rows) {
    const from = Date.parse(r.effective_from);
    if (!Number.isFinite(from) || from > now.getTime()) continue;
    if (!best || r.version > best.version) best = r;
  }
  return best;
}

/** All money policy versions (bookings are evaluated with their own version). */
export function usePolicies(): PolicyState & {
  policyFor: (version: number) => MoneyPolicy | null;
} {
  const [state, setState] = useState<{ rows: PolicyRow[]; loading: boolean; error: string | null }>(
    { rows: [], loading: true, error: null },
  );
  useEffect(() => {
    let alive = true;
    fetchPolicies()
      .then((rows) => alive && setState({ rows, loading: false, error: null }))
      .catch((e: Error) => alive && setState((s) => ({ ...s, loading: false, error: e.message })));
    return () => {
      alive = false;
    };
  }, []);
  const policies = new Map(state.rows.map((r) => [r.version, r]));
  const policyFor = (version: number): MoneyPolicy | null => {
    const row = policies.get(version);
    if (row) return row.policy;
    // Built-in copy of v1 is only a fallback for version 1 when the table is unreachable.
    if (state.error && version === DEFAULT_POLICY.version) return DEFAULT_POLICY;
    return null;
  };
  // Evaluated at render time, so a version whose effective_from arrives while the page is open
  // takes over without a reload.
  const active = pickActive(state.rows, new Date());
  return { policies, active, loading: state.loading, error: state.error, policyFor };
}

/** The active policy, falling back to the built-in v1 only if the table can't be read. */
export function useActivePolicy(): {
  policy: MoneyPolicy | null;
  row: PolicyRow | null;
  loading: boolean;
  error: string | null;
  source: "db" | "builtin" | null;
} {
  const s = usePolicies();
  if (s.loading) return { policy: null, row: null, loading: true, error: null, source: null };
  if (s.active)
    return { policy: s.active.policy, row: s.active, loading: false, error: null, source: "db" };
  return {
    policy: DEFAULT_POLICY,
    row: null,
    loading: false,
    error: s.error ?? "no active policy",
    source: "builtin",
  };
}
