import { NavLink } from "react-router-dom";
import { ADMIN_NAV, STAFF_NAV } from "./nav";
import { cx } from "../ui/cx";
import type { Role } from "../../lib/supabase";

const link = ({ isActive }: { isActive: boolean }) =>
  cx(
    "flex min-h-11 items-center rounded-lg px-3 text-sm font-semibold",
    isActive ? "bg-info-bg text-info" : "text-muted hover:bg-surface-muted hover:text-fg",
  );

/** Desktop console navigation. Admins also see Payouts, Policies, Health, Reconciliation and Test tools. */
export function StaffSidebar({ role }: { role: Role }) {
  return (
    <nav
      aria-label="Console"
      data-testid="main-nav"
      className="sticky top-20 hidden w-52 shrink-0 self-start md:block"
    >
      <ul className="space-y-1">
        {STAFF_NAV.map((n) => (
          <li key={n.to}>
            <NavLink to={n.to} end={n.end} className={link} data-testid={n.testId}>
              {n.label}
            </NavLink>
          </li>
        ))}
      </ul>
      {role === "admin" && (
        <>
          <p className="mb-1 mt-4 px-3 text-xs font-semibold uppercase tracking-wide text-muted">
            Admin
          </p>
          <ul className="space-y-1">
            {ADMIN_NAV.map((n) => (
              <li key={n.to}>
                <NavLink to={n.to} className={link} data-testid={n.testId}>
                  {n.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </>
      )}
    </nav>
  );
}
