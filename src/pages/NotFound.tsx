import { Link, useLocation } from "react-router-dom";
import { Compass } from "lucide-react";
import { useAuth, homeFor } from "../lib/auth";
import { Button, EmptyState, H1 } from "../components/ui";

/** Pages in the product plan that are not built yet. They get a plain "coming soon" instead of a 404. */
const PLANNED = [
  "/services",
  "/how-it-works",
  "/help",
  "/safety",
  "/become-a-tasker",
  "/signup",
  "/messages",
  "/account",
  "/tasker/jobs",
  "/tasker/calendar",
  "/tasker/earnings",
  "/console/",
];

export default function NotFound() {
  const { pathname } = useLocation();
  const { profile, session } = useAuth();
  const planned = PLANNED.some(
    (p) => pathname === p || pathname.startsWith(p.endsWith("/") ? p : `${p}/`),
  );
  const home = session ? homeFor(profile?.role) : "/";
  return (
    <div className="mx-auto max-w-xl" data-testid={planned ? "coming-soon" : "not-found"}>
      <H1
        sub={
          planned ? "We are still building this part of TaskNest." : "We could not find that page."
        }
      >
        {planned ? "Coming soon" : "Page not found"}
      </H1>
      <EmptyState icon={<Compass size={32} aria-hidden="true" />}>
        <p className="mb-1">
          {planned ? (
            <>
              <code>{pathname}</code> is not available yet.
            </>
          ) : (
            <>
              Nothing lives at <code>{pathname}</code>. The link may be old or mistyped.
            </>
          )}
        </p>
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          <Link to={home}>
            <Button>{session ? "Go to your home" : "Go to the home page"}</Button>
          </Link>
          <Link to="/pricing">
            <Button variant="secondary">Pricing &amp; policies</Button>
          </Link>
        </div>
      </EmptyState>
    </div>
  );
}
