import { useEffect, useState } from "react";
import { DEFAULT_POLICY, type MoneyPolicy } from "@domain";
import { supabase, type PolicyRow } from "./supabase";

export interface PolicyState {
  policies: Map<number, PolicyRow>;
  active: PolicyRow | null;       // highest version already in effect
  loading: boolean;
  error: string | null;
}

let cache: Promise<PolicyRow[]> | null = null;

export function fetchPolicies(force = false): Promise<PolicyRow[]> {
  if (!cache || force) {
    cache = Promise.resolve(
      supabase.from("money_policies").select("version, policy, effective_from").order("version", { ascending: true }),
    ).then(({ data, error }) => {
      if (error) { cache = null; throw new Error(error.message); }
      return (data ?? []) as PolicyRow[];
    });
  }
  return cache;
}

export function pickActive(rows: PolicyRow[], now = new Date()): PolicyRow | null {
  const eff = rows.filter((r) => new Date(r.effective_from) <= now).sort((a, b) => b.version - a.version);
  return eff[0] ?? null;
}

/** All money policy versions (bookings are evaluated with their own version). */
export function usePolicies(): PolicyState & { policyFor: (version: number) => MoneyPolicy | null } {
  const [state, setState] = useState<PolicyState>({ policies: new Map(), active: null, loading: true, error: null });
  useEffect(() => {
    let alive = true;
    fetchPolicies()
      .then((rows) => alive && setState({ policies: new Map(rows.map((r) => [r.version, r])), active: pickActive(rows), loading: false, error: null }))
      .catch((e: Error) => alive && setState((s) => ({ ...s, loading: false, error: e.message })));
    return () => { alive = false; };
  }, []);
  const policyFor = (version: number): MoneyPolicy | null => {
    const row = state.policies.get(version);
    if (row) return row.policy;
    // Built-in copy of v1 is only a fallback for version 1 when the table is unreachable.
    if (state.error && version === DEFAULT_POLICY.version) return DEFAULT_POLICY;
    return null;
  };
  return { ...state, policyFor };
}

/** The active policy, falling back to the built-in v1 only if the table can't be read. */
export function useActivePolicy(): { policy: MoneyPolicy | null; row: PolicyRow | null; loading: boolean; error: string | null; source: "db" | "builtin" | null } {
  const s = usePolicies();
  if (s.loading) return { policy: null, row: null, loading: true, error: null, source: null };
  if (s.active) return { policy: s.active.policy, row: s.active, loading: false, error: null, source: "db" };
  return { policy: DEFAULT_POLICY, row: null, loading: false, error: s.error ?? "no active policy", source: "builtin" };
}
