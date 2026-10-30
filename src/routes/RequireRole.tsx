import { Navigate } from "react-router-dom";
import type { ReactNode } from "react";
import { homeFor, useAuth } from "../lib/auth";
import type { Role } from "../lib/supabase";
import { Spinner } from "../components/ui";

export function RequireRole({ roles, children }: { roles: Role[]; children: ReactNode }) {
  const { session, profile, loading } = useAuth();
  if (loading) return <Spinner />;
  if (!session) return <Navigate to="/signin" replace />;
  if (!profile) return <Spinner />;
  if (!roles.includes(profile.role)) return <Navigate to={homeFor(profile.role)} replace />;
  return <>{children}</>;
}
