import { Link } from "react-router-dom";
import { Logo } from "./Logo";
import { SimulatedBadge } from "../ui/SimulatedBadge";
import { providerLabel, useHealth } from "../../lib/health";

export function Footer() {
  const { provider } = useHealth();
  return (
    <footer
      className="mt-12 border-t border-line bg-surface-muted pb-24 pt-8 md:pb-8"
      data-testid="footer"
    >
      <div className="mx-auto flex max-w-[1200px] flex-col gap-6 px-4 md:flex-row md:justify-between md:px-6">
        <div className="max-w-sm">
          <Logo />
          <p className="mt-2 text-sm text-muted">
            Trusted help for everyday tasks. Your payment is held, not taken, until the job is done.
          </p>
          {provider === "fake" && (
            <p className="mt-3 flex items-center gap-2 text-xs text-muted">
              <SimulatedBadge testId="footer-simulated" />
              Payments here are simulated. No real card is charged.
            </p>
          )}
          {provider && provider !== "fake" && (
            <p className="mt-3 text-xs text-muted">{providerLabel(provider)} (test mode)</p>
          )}
        </div>
        <nav aria-label="Footer" className="grid grid-cols-2 gap-x-10 gap-y-2 text-sm">
          <Link className="text-link hover:underline" to="/pricing" data-testid="footer-pricing">
            Pricing &amp; policies
          </Link>
          <Link className="text-link hover:underline" to="/help">
            Help centre
          </Link>
          <Link className="text-link hover:underline" to="/safety">
            Trust &amp; safety
          </Link>
          <Link className="text-link hover:underline" to="/become-a-tasker">
            Become a tasker
          </Link>
        </nav>
      </div>
      <p className="mx-auto mt-6 max-w-[1200px] px-4 text-xs text-muted md:px-6">
        © 2026 TaskNest. A demonstration marketplace.
      </p>
    </footer>
  );
}
