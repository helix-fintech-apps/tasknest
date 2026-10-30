import { Navigate } from "react-router-dom";
import { homeFor, useAuth } from "../lib/auth";
import { Spinner } from "../components/ui";

export function Home() {
  const { session, profile, loading } = useAuth();
  if (loading || (session && !profile)) return <Spinner />;
  return <Navigate to={session ? homeFor(profile?.role) : "/signin"} replace />;
}
