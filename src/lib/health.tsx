import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { API_BASE } from "./api/core";
import { SUPABASE_ANON_KEY } from "./supabase";

export interface Health {
  ok: boolean;
  /** "fake" (simulated) or "stripe" (Stripe test mode). */
  provider?: string;
  build?: string;
  /** Server feature flags (WS7). Missing means every flag is off. */
  features?: Record<string, boolean>;
}

const empty: Health = { ok: false };
const Ctx = createContext<Health>(empty);

/** Reads GET /health once per page load and shares it (provider badge, feature flags). */
export function HealthProvider({ children }: { children: ReactNode }) {
  const [health, setHealth] = useState<Health>(empty);
  useEffect(() => {
    let alive = true;
    fetch(`${API_BASE}/health`, {
      headers: SUPABASE_ANON_KEY
        ? { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` }
        : {},
    })
      .then((r) => (r.ok ? r.json() : empty))
      .then((j: Health) => alive && setHealth({ ...j, ok: j?.ok !== false }))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);
  return <Ctx.Provider value={health}>{children}</Ctx.Provider>;
}

export const useHealth = (): Health => useContext(Ctx);

/** "Payments: Simulated" or "Payments: Stripe test" (null until /health answers). */
export function providerLabel(provider: string | undefined): string | null {
  if (!provider) return null;
  if (provider === "fake") return "Payments: Simulated";
  if (provider.startsWith("stripe")) return "Payments: Stripe test";
  return `Payments: ${provider}`;
}
