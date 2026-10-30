import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronDown, LogOut, Monitor, Moon, Sun } from "lucide-react";
import { Avatar } from "../ui/Avatar";
import { useTheme, type ThemeChoice } from "../../lib/theme";
import type { Profile } from "../../lib/supabase";

const THEMES: { id: ThemeChoice; label: string; icon: typeof Sun }[] = [
  { id: "system", label: "System", icon: Monitor },
  { id: "light", label: "Light", icon: Sun },
  { id: "dark", label: "Dark", icon: Moon },
];

/** Avatar button with a panel: who you are, the theme choice, links, and (on phones) Sign out. */
export function AccountMenu({
  profile,
  email,
  desktop,
  onSignOut,
  showAccountLink,
}: {
  profile: Profile | null;
  email: string;
  desktop: boolean;
  onSignOut: () => void;
  showAccountLink: boolean;
}) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const { choice, setChoice } = useTheme();
  const name = profile?.full_name || email;

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  return (
    <div ref={wrap} className="relative">
      <button
        type="button"
        data-testid="account-menu"
        aria-expanded={open}
        aria-label={desktop ? undefined : `Account menu for ${name}`}
        onClick={() => setOpen((o) => !o)}
        className="flex min-h-11 items-center gap-2 rounded-lg px-1.5 hover:bg-surface-muted"
      >
        <Avatar name={name} size={32} decorative />
        {desktop && (
          <>
            <span data-testid="current-user" className="text-sm font-medium text-fg">
              {name}{" "}
              <span className="text-xs font-normal text-muted">
                ({profile?.role?.replace("_", " ") ?? "…"})
              </span>
            </span>
            <ChevronDown size={16} aria-hidden="true" className="text-muted" />
          </>
        )}
      </button>
      {open && (
        <div
          role="region"
          aria-label="Account"
          className="absolute right-0 top-full z-40 mt-2 w-72 max-w-[calc(100vw-2rem)] rounded-xl border border-line bg-surface p-3 shadow-[var(--shadow-3)]"
        >
          <p
            data-testid={desktop ? undefined : "current-user"}
            className="px-1 text-sm font-semibold text-fg"
          >
            {name}
          </p>
          <p className="mb-2 px-1 text-xs text-muted">
            {email} · {profile?.role?.replace("_", " ")}
          </p>
          <fieldset className="mb-2 border-t border-line pt-2">
            <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-muted">
              Appearance
            </legend>
            <div className="flex gap-1" data-testid="theme-choice">
              {THEMES.map((t) => (
                <label
                  key={t.id}
                  className={`flex min-h-11 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-lg border px-2 text-sm has-[:focus-visible]:outline has-[:focus-visible]:outline-[3px] has-[:focus-visible]:outline-focus ${
                    choice === t.id
                      ? "border-primary bg-info-bg font-semibold text-info"
                      : "border-line text-muted"
                  }`}
                >
                  <input
                    type="radio"
                    name="tn-theme"
                    value={t.id}
                    checked={choice === t.id}
                    onChange={() => setChoice(t.id)}
                    data-testid={`theme-${t.id}`}
                    className="sr-only"
                  />
                  <t.icon size={16} aria-hidden="true" />
                  {t.label}
                </label>
              ))}
            </div>
          </fieldset>
          <ul className="border-t border-line pt-2 text-sm">
            {showAccountLink && (
              <li>
                <Link
                  to="/account"
                  onClick={() => setOpen(false)}
                  className="flex min-h-11 items-center rounded-lg px-2 text-fg hover:bg-surface-muted"
                >
                  Account settings
                </Link>
              </li>
            )}
            <li>
              <Link
                to="/pricing"
                data-testid="nav-pricing"
                onClick={() => setOpen(false)}
                className="flex min-h-11 items-center rounded-lg px-2 text-fg hover:bg-surface-muted"
              >
                Pricing &amp; policies
              </Link>
            </li>
            {!desktop && (
              <li>
                <button
                  type="button"
                  data-testid="sign-out"
                  onClick={onSignOut}
                  className="flex min-h-11 w-full items-center gap-2 rounded-lg px-2 text-left text-fg hover:bg-surface-muted"
                >
                  <LogOut size={16} aria-hidden="true" /> Sign out
                </button>
              </li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
