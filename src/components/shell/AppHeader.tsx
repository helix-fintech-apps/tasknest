import { useEffect, useState } from "react";
import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";
import { Menu } from "lucide-react";
import { homeFor, useAuth } from "../../lib/auth";
import { supabase } from "../../lib/supabase";
import { Button } from "../ui/Button";
import { Logo } from "./Logo";
import { navFor, PUBLIC_NAV, topNavFor, type NavItem } from "./nav";
import { AccountMenu } from "./AccountMenu";
import { NotificationBell } from "./NotificationBell";
import { ProviderBadge } from "./ProviderBadge";
import { BottomTabBar } from "./BottomTabBar";
import { Drawer } from "./Drawer";
import { useIsDesktop } from "./useMediaQuery";
import { cx } from "../ui/cx";

const topLink = ({ isActive }: { isActive: boolean }) =>
  cx(
    "inline-flex min-h-11 items-center rounded-lg px-3 text-sm font-semibold",
    isActive ? "bg-info-bg text-info" : "text-muted hover:bg-surface-muted hover:text-fg",
  );

/** Count of the client's bookings whose payment needs approval (drives the "My tasks" badge). */
function useNeedsAction(userId: string | undefined, enabled: boolean): number {
  const [n, setN] = useState(0);
  const { pathname } = useLocation();
  useEffect(() => {
    if (!enabled || !userId) {
      setN(0);
      return;
    }
    let alive = true;
    supabase
      .from("bookings")
      .select("id")
      .eq("client_id", userId)
      .eq("payment_state", "action_required")
      .then(({ data, error }) => {
        if (alive) setN(!error && data ? data.length : 0);
      });
    return () => {
      alive = false;
    };
  }, [userId, enabled, pathname]);
  return n;
}

function NavLinks({ items, badges }: { items: NavItem[]; badges: Record<string, number> }) {
  return (
    <>
      {items.map((n) => (
        <NavLink key={n.to} to={n.to} end={n.end} className={topLink} data-testid={n.testId}>
          {n.label}
          {(badges[n.testId] ?? 0) > 0 && (
            <span
              data-testid={`${n.testId}-badge`}
              className="ml-2 rounded-full bg-danger px-1.5 text-xs font-bold leading-5 text-surface"
            >
              {badges[n.testId]}
              <span className="sr-only"> need action</span>
            </span>
          )}
        </NavLink>
      ))}
    </>
  );
}

/** Role-aware header: public bar, client/tasker top bar (+ bottom tabs on phones), staff bar. */
export function AppHeader() {
  const { profile, session, signOut } = useAuth();
  const nav = useNavigate();
  const desktop = useIsDesktop();
  const [drawer, setDrawer] = useState(false);
  const { pathname } = useLocation();
  const role = profile?.role;
  const signedIn = !!session;
  const needs = useNeedsAction(session?.user.id, role === "client");
  const badges = { "nav-bookings": needs };

  useEffect(() => setDrawer(false), [pathname]);

  const doSignOut = async () => {
    await signOut();
    nav("/signin");
  };
  const email = session?.user.email ?? "";
  const staff = role === "admin" || role === "support_agent";

  return (
    <>
      <header
        className="sticky top-0 z-30 border-b border-line bg-surface/95 backdrop-blur"
        data-testid="app-header"
      >
        <div className="mx-auto flex min-h-16 max-w-[1200px] items-center gap-2 px-4 md:gap-4 md:px-6">
          <Link
            to={signedIn ? homeFor(role) : "/"}
            aria-label="TaskNest home"
            data-testid="logo-link"
            className="mr-1 shrink-0 rounded-lg"
          >
            <Logo />
          </Link>

          {desktop && staff ? (
            <div className="flex-1" />
          ) : desktop ? (
            <nav
              aria-label="Main"
              data-testid="main-nav"
              className="flex flex-1 flex-wrap items-center gap-1"
            >
              <NavLinks items={signedIn ? topNavFor(role) : PUBLIC_NAV} badges={badges} />
            </nav>
          ) : (
            <div className="flex-1" />
          )}

          {staff && desktop && <ProviderBadge />}

          {signedIn ? (
            <div className="flex items-center gap-1">
              {profile && <NotificationBell userId={profile.id} />}
              <AccountMenu
                profile={profile}
                email={email}
                desktop={desktop}
                onSignOut={doSignOut}
                showAccountLink={role === "client" || role === "tasker"}
              />
              {desktop && (
                <button
                  type="button"
                  data-testid="sign-out"
                  onClick={doSignOut}
                  className="min-h-11 rounded-lg px-3 text-sm font-semibold text-muted hover:bg-surface-muted hover:text-fg"
                >
                  Sign out
                </button>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <NavLink
                to="/signin"
                data-testid="nav-signin"
                className="inline-flex min-h-11 items-center rounded-lg px-3 text-sm font-semibold text-link hover:bg-surface-muted"
              >
                Sign in
              </NavLink>
              {desktop && (
                <Button size="md" data-testid="nav-book" onClick={() => nav("/services")}>
                  Book a task
                </Button>
              )}
              {!desktop && (
                <button
                  type="button"
                  data-testid="open-menu"
                  aria-label="Open menu"
                  onClick={() => setDrawer(true)}
                  className="inline-flex h-11 w-11 items-center justify-center rounded-lg text-fg hover:bg-surface-muted"
                >
                  <Menu size={22} aria-hidden="true" />
                </button>
              )}
            </div>
          )}
        </div>
      </header>

      {/* Staff on phones: a section switcher instead of tabs. */}
      {staff && !desktop && (
        <div className="border-b border-line bg-surface px-4 py-2">
          <label className="flex items-center gap-2 text-sm font-medium text-fg">
            <span>Section</span>
            <select
              data-testid="console-section"
              className="min-h-11 flex-1 rounded-lg border border-line-input bg-surface px-3 text-base text-fg"
              value={
                navFor(role).find((n) => pathname === n.to || pathname.startsWith(`${n.to}/`))
                  ?.to ?? "/console"
              }
              onChange={(e) => nav(e.target.value)}
            >
              {navFor(role).map((n) => (
                <option key={n.to} value={n.to}>
                  {n.label}
                </option>
              ))}
            </select>
          </label>
          <div className="mt-2">
            <ProviderBadge />
          </div>
        </div>
      )}

      {!desktop && (role === "client" || role === "tasker") && (
        <BottomTabBar items={navFor(role)} badges={badges} />
      )}

      {!desktop && !signedIn && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <Button
            size="lg"
            className="w-full"
            data-testid="sticky-book"
            onClick={() => nav("/services")}
          >
            Book a task
          </Button>
        </div>
      )}

      {drawer && (
        <Drawer onClose={() => setDrawer(false)}>
          <nav aria-label="Menu" data-testid="main-nav" className="flex flex-col">
            {PUBLIC_NAV.map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                data-testid={n.testId}
                onClick={() => setDrawer(false)}
                className="flex min-h-12 items-center rounded-lg px-2 text-base font-semibold text-fg hover:bg-surface-muted"
              >
                {n.label}
              </NavLink>
            ))}
          </nav>
        </Drawer>
      )}
    </>
  );
}
