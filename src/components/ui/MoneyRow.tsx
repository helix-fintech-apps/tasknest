import type { ReactNode } from "react";
import { money } from "../../lib/format";

export function MoneyRow({
  label,
  cents,
  testId,
  strong,
  negative,
  muted,
}: {
  label: ReactNode;
  cents: number;
  testId?: string;
  strong?: boolean;
  negative?: boolean;
  muted?: boolean;
}) {
  return (
    <div
      className={`flex justify-between py-1 text-sm ${strong ? "border-t border-slate-200 pt-2 font-semibold text-slate-900" : muted ? "text-slate-400" : "text-slate-700"}`}
    >
      <span>{label}</span>
      <span data-testid={testId} className="tabular-nums">
        {negative && cents > 0 ? `−${money(cents)}` : money(cents)}
      </span>
    </div>
  );
}
