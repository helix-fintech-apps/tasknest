import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";

/** Title shown when a page has no <h1> (or before it renders). Longest matching prefix wins. */
const FALLBACK_TITLES: [string, string][] = [
  ["/signin", "Sign in"],
  ["/pricing", "Pricing & policies"],
  ["/taskers", "Find a tasker"],
  ["/bookings", "My tasks"],
  ["/rewards", "Rewards"],
  ["/points", "Rewards"],
  ["/tasker", "Today"],
  ["/console", "Console"],
];

function fallbackTitle(path: string): string {
  const hit = FALLBACK_TITLES.filter(([p]) => path === p || path.startsWith(`${p}/`)).sort(
    (a, b) => b[0].length - a[0].length,
  )[0];
  return hit ? hit[1] : "TaskNest";
}

/**
 * On every client-side navigation: sets document.title to "<Page> · TaskNest" (from the page's h1),
 * moves focus to that h1, and announces the new page to screen readers in a polite live region.
 * The first page load keeps the browser's own focus handling.
 */
export function RouteAnnouncer() {
  const { pathname } = useLocation();
  const [message, setMessage] = useState("");
  const lastPath = useRef<string | null>(null);

  useEffect(() => {
    // Only a change of path counts as a navigation (not the first load, not a StrictMode re-run).
    const navigated = lastPath.current !== null && lastPath.current !== pathname;
    lastPath.current = pathname;
    let done = false;
    const apply = (h1: HTMLElement | null) => {
      const name = h1?.textContent?.trim() || fallbackTitle(pathname);
      document.title = name === "TaskNest" ? "TaskNest" : `${name} · TaskNest`;
      setMessage(name);
      if (h1 && navigated) {
        if (!h1.hasAttribute("tabindex")) h1.setAttribute("tabindex", "-1");
        h1.focus({ preventScroll: true });
        window.scrollTo(0, 0);
      }
    };
    const find = () => document.querySelector<HTMLElement>("#main h1");
    const finish = (h1: HTMLElement | null) => {
      if (done) return;
      done = true;
      obs.disconnect();
      clearTimeout(timer);
      apply(h1);
    };
    const obs = new MutationObserver(() => {
      const h = find();
      if (h) finish(h);
    });
    const main = document.getElementById("main");
    if (main) obs.observe(main, { childList: true, subtree: true });
    // Pages that load data show their h1 immediately; give slow ones a moment, then use the fallback.
    const timer = setTimeout(() => finish(find()), 2500);
    const h = find();
    if (h) finish(h);
    return () => {
      done = true;
      obs.disconnect();
      clearTimeout(timer);
    };
  }, [pathname]);

  return (
    <div aria-live="polite" role="status" className="sr-only" data-testid="route-announcer">
      {message}
    </div>
  );
}
