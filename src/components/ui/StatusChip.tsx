import type { ReactNode } from "react";
import {
  Ban,
  Banknote,
  CircleAlert,
  CircleCheck,
  CircleX,
  Clock,
  Hourglass,
  Landmark,
  Lock,
  RotateCcw,
  ShieldAlert,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { cx } from "./cx";

export type ChipTone = "neutral" | "info" | "success" | "warning" | "danger" | "hold";

const toneClass: Record<ChipTone, string> = {
  neutral: "bg-surface-muted text-muted border-line",
  info: "bg-info-bg text-info border-info/30",
  success: "bg-success-bg text-success border-success/30",
  warning: "bg-warning-bg text-warning border-warning/30",
  danger: "bg-danger-bg text-danger border-danger/30",
  hold: "bg-hold-bg text-hold border-hold/30",
};

type Icon = LucideIcon;
interface Def {
  tone: ChipTone;
  label: string;
  icon: Icon;
}

/** The chip vocabulary from the UI-state glossary (plan section 12). The label is always shown. */
export const STATUS_CHIPS = {
  pending_payment: { tone: "warning", label: "Finishing payment", icon: Hourglass },
  payment_abandoned: { tone: "neutral", label: "Payment not completed", icon: Ban },
  requested: { tone: "info", label: "Waiting for tasker", icon: Clock },
  accepted: { tone: "success", label: "Confirmed", icon: CircleCheck },
  card_saved: { tone: "neutral", label: "Card saved", icon: Wallet },
  hold_active: { tone: "hold", label: "Hold", icon: Lock },
  action_required: { tone: "danger", label: "Payment needs your approval", icon: CircleAlert },
  in_progress: { tone: "info", label: "In progress", icon: Clock },
  completed: { tone: "success", label: "Completed", icon: CircleCheck },
  canceled_client: { tone: "neutral", label: "Cancelled by you", icon: Ban },
  canceled_tasker: { tone: "neutral", label: "Cancelled by tasker", icon: Ban },
  declined: { tone: "neutral", label: "Declined", icon: CircleX },
  expired: { tone: "neutral", label: "Expired", icon: Hourglass },
  no_show_client: { tone: "danger", label: "No-show", icon: CircleX },
  no_show_tasker: { tone: "neutral", label: "No-show", icon: CircleX },
  disputed: { tone: "danger", label: "Card dispute", icon: ShieldAlert },
  released: { tone: "neutral", label: "Released", icon: RotateCcw },
  refund_pending: { tone: "warning", label: "Refund pending at bank", icon: Hourglass },
  refunded: { tone: "success", label: "Refunded", icon: CircleCheck },
  refund_failed: { tone: "danger", label: "Refund failed", icon: CircleX },
  transfer_sent: { tone: "neutral", label: "Sent to payout account", icon: Banknote },
  paying_out: { tone: "info", label: "Paying out", icon: Landmark },
  paid_out: { tone: "success", label: "In your bank", icon: Landmark },
  payout_failed: { tone: "danger", label: "Payout failed", icon: CircleX },
} as const satisfies Record<string, Def>;

export type StatusKey = keyof typeof STATUS_CHIPS;

/**
 * `<StatusChip status="hold_active" detail="$83.50 · releases by Nov 9" />` renders
 * "Hold $83.50 · releases by Nov 9". Unknown statuses fall back to a neutral chip with the raw name.
 */
export function StatusChip({
  status,
  detail,
  label,
  tone,
  testId,
  className = "",
}: {
  status: string;
  /** Appended after the label, e.g. a date or an amount. */
  detail?: ReactNode;
  /** Replaces the default label (e.g. "Waiting for Tara"). */
  label?: string;
  tone?: ChipTone;
  testId?: string;
  className?: string;
}) {
  const def: Def | undefined = (STATUS_CHIPS as Record<string, Def>)[status];
  const t = tone ?? def?.tone ?? "neutral";
  const Icon = def?.icon ?? Clock;
  const text = label ?? def?.label ?? status.replace(/_/g, " ");
  return (
    <span
      data-testid={testId}
      data-status={status}
      className={cx(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold",
        toneClass[t],
        className,
      )}
    >
      <Icon size={14} aria-hidden="true" />
      <span>
        {text}
        {detail ? <> {detail}</> : null}
      </span>
    </span>
  );
}
