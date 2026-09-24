import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase, type Profile } from "./supabase";

interface AuthState {
  session: Session | null;
  profile: Profile | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<Profile | null>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const Ctx = createContext<AuthState | null>(null);

async function loadProfile(userId: string): Promise<Profile | null> {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, role, full_name, home_tz")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw error;
  return (data as Profile) ?? null;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    supabase.auth.getSession().then(async ({ data }) => {
      if (!alive) return;
      setSession(data.session);
      if (data.session) setProfile(await loadProfile(data.session.user.id).catch(() => null));
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_evt, s) => {
      setSession(s);
      if (!s) setProfile(null);
    });
    return () => {
      alive = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const value: AuthState = {
    session,
    profile,
    loading,
    async signIn(email, password) {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      setSession(data.session);
      const p = await loadProfile(data.user.id);
      setProfile(p);
      return p;
    },
    async signOut() {
      await supabase.auth.signOut();
      setSession(null);
      setProfile(null);
    },
    async refreshProfile() {
      if (session) setProfile(await loadProfile(session.user.id));
    },
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth outside AuthProvider");
  return v;
}

export function homeFor(role: Profile["role"] | undefined): string {
  switch (role) {
    case "tasker":
      return "/tasker";
    case "admin":
    case "support_agent":
      return "/console";
    default:
      return "/taskers";
  }
}
