import { FlaskConical, CreditCard } from "lucide-react";
import { providerLabel, useHealth } from "../../lib/health";

/** "Payments: Simulated" or "Payments: Stripe test", read from GET /health. Shown to staff. */
export function ProviderBadge() {
  const { provider } = useHealth();
  const text = providerLabel(provider);
  if (!text) return null;
  const simulated = provider === "fake";
  return (
    <span
      data-testid="provider-badge"
      data-provider={provider}
      className={
        simulated
          ? "tn-simulated-stripe inline-flex items-center gap-1.5 rounded-md border border-line-input px-2 py-1 text-xs font-bold"
          : "inline-flex items-center gap-1.5 rounded-md border border-info/30 bg-info-bg px-2 py-1 text-xs font-bold text-info"
      }
      style={
        simulated
          ? { color: "var(--tn-simulated-fg)", backgroundColor: "var(--tn-surface)" }
          : undefined
      }
    >
      {simulated ? (
        <FlaskConical size={13} aria-hidden="true" />
      ) : (
        <CreditCard size={13} aria-hidden="true" />
      )}
      <span className={simulated ? "rounded bg-surface px-1" : ""}>{text}</span>
    </span>
  );
}
