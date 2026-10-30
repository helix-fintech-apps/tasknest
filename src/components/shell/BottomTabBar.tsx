import { NavLink } from "react-router-dom";
import type { NavItem } from "./nav";
import { cx } from "../ui/cx";

/** Phone navigation for signed-in clients and taskers. Carries the same test ids as the desktop top bar. */
export function BottomTabBar({
  items,
  badges = {},
}: {
  items: NavItem[];
  badges?: Record<string, number>;
}) {
  return (
    <nav
      aria-label="Main"
      data-testid="main-nav"
      className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)]"
    >
      <ul className="mx-auto flex max-w-lg">
        {items.map((n) => {
          const Icon = n.icon;
          const count = badges[n.testId] ?? 0;
          return (
            <li key={n.to} className="flex-1">
              <NavLink
                to={n.to}
                end={n.end}
                data-testid={n.testId}
                className={({ isActive }) =>
                  cx(
                    "relative flex min-h-14 flex-col items-center justify-center gap-0.5 px-1 text-[11px] font-semibold",
                    isActive ? "text-link" : "text-muted",
                  )
                }
              >
                {Icon && <Icon size={22} aria-hidden="true" />}
                <span>{n.tab ?? n.label}</span>
                {count > 0 && (
                  <span
                    data-testid={`${n.testId}-badge`}
                    className="absolute right-[22%] top-1 min-w-4 rounded-full bg-danger px-1 text-[10px] font-bold leading-4 text-surface"
                  >
                    {count}
                    <span className="sr-only"> need action</span>
                  </span>
                )}
              </NavLink>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
