import { useId, useState } from "react";
import { Lock } from "lucide-react";
import { fmtDate } from "../../lib/format";
import { Money } from "./Money";
import { cx } from "./cx";

/**
 * "Hold $83.50 · releases by Nov 9", with a "Hold, not a charge" popover. A card hold reserves
 * money on the card; nothing is charged until the job is done.
 */
export function HoldChip({
  state,
  amountCents,
  captureBefore,
  holdAt,
  testId,
}: {
  state: "hold_active" | "card_saved" | "released" | "captured" | string;
  amountCents: number;
  captureBefore?: string | Date | null;
  holdAt?: string | Date | null;
  testId?: string;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const label =
    state === "card_saved"
      ? "Card saved"
      : state === "released"
        ? "Hold released"
        : state === "captured"
          ? "Charged"
          : "Hold";
  const when =
    state === "hold_active" && captureBefore
      ? ` · releases by ${fmtDate(captureBefore)}`
      : state === "card_saved" && holdAt
        ? ` · hold on ${fmtDate(holdAt)}`
        : "";
  return (
    <span className="relative inline-block">
      <button
        type="button"
        data-testid={testId}
        data-hold-state={state}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => e.key === "Escape" && setOpen(false)}
        className={cx(
          "inline-flex min-h-8 items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold",
          state === "hold_active"
            ? "border-hold/30 bg-hold-bg text-hold"
            : "border-line bg-surface-muted text-muted",
        )}
      >
        <Lock size={14} aria-hidden="true" />
        <span>
          {label} <Money cents={amountCents} kind="card_hold" />
          {when}
        </span>
      </button>
      {open && (
        <span
          id={id}
          role="note"
          className="absolute left-0 top-full z-20 mt-2 block w-64 rounded-xl border border-line bg-surface p-3 text-left text-xs font-normal text-fg shadow-[var(--shadow-2)]"
        >
          <strong className="block text-sm">Hold, not a charge</strong>
          Your bank reserves this amount. You are only charged when the task is done, and the hold
          drops off by itself if it is not used.
        </span>
      )}
    </span>
  );
}
