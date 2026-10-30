import { FlaskConical } from "lucide-react";
import { cx } from "./cx";

/**
 * Marks anything produced by the fake (simulated) provider: payment forms, Connect onboarding,
 * webhooks, payouts. It is always visible text, never colour alone.
 */
export function SimulatedBadge({
  children = "Simulated",
  className = "",
  testId = "simulated-badge",
}: {
  children?: string;
  className?: string;
  testId?: string;
}) {
  return (
    <span
      data-testid={testId}
      className={cx(
        "tn-simulated-stripe inline-flex items-center gap-1 rounded-md border border-line-input px-2 py-0.5 text-xs font-bold uppercase tracking-wide",
        className,
      )}
      style={{ color: "var(--tn-simulated-fg)", backgroundColor: "var(--tn-surface)" }}
    >
      <FlaskConical size={12} aria-hidden="true" />
      <span className="rounded bg-surface px-1">{children}</span>
    </span>
  );
}
