import {
  Banknote,
  Calendar,
  ClipboardList,
  Gift,
  LayoutDashboard,
  MessageSquare,
  Search,
  User,
  Briefcase,
  type LucideIcon,
} from "lucide-react";
import type { Role } from "../../lib/supabase";

export interface NavItem {
  to: string;
  label: string;
  testId: string;
  icon?: LucideIcon;
  /** Short label for the phone tab bar. */
  tab?: string;
  /** Match the route exactly (so "/tasker" is not active on "/tasker/jobs"). */
  end?: boolean;
}

export const PUBLIC_NAV: NavItem[] = [
  { to: "/services", label: "Services", testId: "nav-services" },
  { to: "/how-it-works", label: "How it works", testId: "nav-how" },
  { to: "/pricing", label: "Pricing", testId: "nav-pricing" },
  { to: "/help", label: "Help", testId: "nav-help" },
  { to: "/become-a-tasker", label: "Become a tasker", testId: "nav-become" },
];

export const CLIENT_NAV: NavItem[] = [
  { to: "/taskers", label: "Book a task", tab: "Book", testId: "nav-taskers", icon: Search },
  { to: "/bookings", label: "My tasks", tab: "Tasks", testId: "nav-bookings", icon: ClipboardList },
  { to: "/messages", label: "Messages", testId: "nav-messages", icon: MessageSquare },
  { to: "/rewards", label: "Rewards", testId: "nav-points", icon: Gift },
  { to: "/account", label: "Account", testId: "nav-account", icon: User },
];

export const TASKER_NAV: NavItem[] = [
  { to: "/tasker", label: "Today", testId: "nav-tasker", icon: LayoutDashboard, end: true },
  { to: "/tasker/jobs", label: "Jobs", testId: "nav-jobs", icon: Briefcase },
  { to: "/tasker/calendar", label: "Calendar", testId: "nav-calendar", icon: Calendar },
  { to: "/tasker/earnings", label: "Earnings", testId: "nav-earnings", icon: Banknote },
  { to: "/account", label: "Account", testId: "nav-account", icon: User },
];

export const STAFF_NAV: NavItem[] = [
  { to: "/console", label: "Queue", testId: "nav-console", end: true },
  { to: "/console/bookings", label: "Bookings", testId: "nav-console-bookings" },
  { to: "/console/disputes", label: "Disputes", testId: "nav-console-disputes" },
  { to: "/console/taskers", label: "Taskers", testId: "nav-console-taskers" },
  { to: "/console/ledger", label: "Ledger", testId: "nav-console-ledger" },
];
export const ADMIN_NAV: NavItem[] = [
  { to: "/console/payouts", label: "Payouts", testId: "nav-console-payouts" },
  { to: "/console/policies", label: "Policies", testId: "nav-console-policies" },
  { to: "/console/health", label: "Health", testId: "nav-console-health" },
  { to: "/console/reconciliation", label: "Reconciliation", testId: "nav-console-recon" },
  { to: "/console/test-tools", label: "Test tools", testId: "nav-console-tools" },
];

/** Primary navigation for a signed-in role. */
export function navFor(role: Role | undefined): NavItem[] {
  switch (role) {
    case "client":
      return CLIENT_NAV;
    case "tasker":
      return TASKER_NAV;
    case "admin":
      return [...STAFF_NAV, ...ADMIN_NAV];
    case "support_agent":
      return STAFF_NAV;
    default:
      return PUBLIC_NAV;
  }
}

/** Desktop top-bar links: the same as the tab bar, minus Account (that lives in the account menu). */
export function topNavFor(role: Role | undefined): NavItem[] {
  if (role === "client" || role === "tasker")
    return navFor(role).filter((n) => n.testId !== "nav-account");
  return navFor(role);
}
