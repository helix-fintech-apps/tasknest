import { Navigate, NavLink, Route, Routes, useNavigate } from "react-router-dom";
import type { ReactNode } from "react";
import { homeFor, useAuth } from "./lib/auth";
import type { Role } from "./lib/supabase";
import { Spinner } from "./components/ui";
import { ErrorBoundary } from "./components/ErrorBoundary";
import SignIn from "./pages/SignIn";
import Taskers from "./pages/Taskers";
import TaskerProfile from "./pages/TaskerProfile";
import MyBookings from "./pages/MyBookings";
import Points from "./pages/Points";
import TaskerDashboard from "./pages/TaskerDashboard";
import Console from "./pages/Console";
import Pricing from "./pages/Pricing";

const NAV: Record<Role, { to: string; label: string; testId: string }[]> = {
  client: [
    { to: "/taskers", label: "Find a tasker", testId: "nav-taskers" },
    { to: "/bookings", label: "My bookings", testId: "nav-bookings" },
    { to: "/points", label: "Points", testId: "nav-points" },
  ],
  tasker: [{ to: "/tasker", label: "Dashboard", testId: "nav-tasker" }],
  admin: [{ to: "/console", label: "Console", testId: "nav-console" }],
  support_agent: [{ to: "/console", label: "Support console", testId: "nav-console" }],
};

function Shell({ children }: { children: ReactNode }) {
  const { profile, session, signOut } = useAuth();
  const nav = useNavigate();
  const links = profile ? NAV[profile.role] : [];
  const linkCls = ({ isActive }: { isActive: boolean }) =>
    `rounded-md px-3 py-1.5 text-sm font-medium ${isActive ? "bg-blue-50 text-blue-700" : "text-slate-600 hover:text-slate-900"}`;
  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-3">
          <NavLink to={homeFor(profile?.role)} className="flex items-center gap-2 text-lg font-semibold text-blue-700">
            <span className="inline-block h-7 w-7 rounded-lg bg-blue-600 text-center text-white">⌂</span> TaskNest
          </NavLink>
          <nav className="flex flex-1 flex-wrap items-center gap-1" data-testid="main-nav">
            {links.map((l) => <NavLink key={l.to} to={l.to} className={linkCls} data-testid={l.testId}>{l.label}</NavLink>)}
            <NavLink to="/pricing" className={linkCls} data-testid="nav-pricing">Pricing & policies</NavLink>
          </nav>
          {session ? (
            <div className="flex items-center gap-3 text-sm">
              <span className="text-slate-600" data-testid="current-user">
                {profile?.full_name || session.user.email} <span className="text-xs text-slate-400">({profile?.role?.replace("_", " ") ?? "…"})</span>
              </span>
              <button data-testid="sign-out" className="text-slate-500 hover:text-slate-800" onClick={async () => { await signOut(); nav("/signin"); }}>Sign out</button>
            </div>
          ) : (
            <NavLink to="/signin" className="text-sm font-medium text-blue-700" data-testid="nav-signin">Sign in</NavLink>
          )}
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8"><ErrorBoundary>{children}</ErrorBoundary></main>
    </div>
  );
}

function RequireRole({ roles, children }: { roles: Role[]; children: ReactNode }) {
  const { session, profile, loading } = useAuth();
  if (loading) return <Spinner />;
  if (!session) return <Navigate to="/signin" replace />;
  if (!profile) return <Spinner />;
  if (!roles.includes(profile.role)) return <Navigate to={homeFor(profile.role)} replace />;
  return <>{children}</>;
}

function Home() {
  const { session, profile, loading } = useAuth();
  if (loading || (session && !profile)) return <Spinner />;
  return <Navigate to={session ? homeFor(profile?.role) : "/signin"} replace />;
}

export default function App() {
  return (
    <Shell>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/signin" element={<SignIn />} />
        <Route path="/pricing" element={<Pricing />} />
        <Route path="/taskers" element={<RequireRole roles={["client", "admin", "support_agent"]}><Taskers /></RequireRole>} />
        <Route path="/taskers/:id" element={<RequireRole roles={["client", "admin", "support_agent"]}><TaskerProfile /></RequireRole>} />
        <Route path="/bookings" element={<RequireRole roles={["client"]}><MyBookings /></RequireRole>} />
        <Route path="/points" element={<RequireRole roles={["client"]}><Points /></RequireRole>} />
        <Route path="/tasker" element={<RequireRole roles={["tasker"]}><TaskerDashboard /></RequireRole>} />
        <Route path="/console" element={<RequireRole roles={["admin", "support_agent"]}><Console /></RequireRole>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Shell>
  );
}
