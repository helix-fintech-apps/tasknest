import type { HTMLAttributes, ReactNode } from "react";
import { cx } from "./cx";

export function Card({
  children,
  className = "",
  ...p
}: { children: ReactNode; className?: string } & HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      {...p}
      className={cx(
        "rounded-xl border border-line bg-surface p-5 shadow-[var(--shadow-1)]",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function Stat({
  label,
  value,
  testId,
  hint,
}: {
  label: string;
  value: ReactNode;
  testId?: string;
  hint?: ReactNode;
}) {
  return (
    <Card className="!p-4">
      <div className="text-xs font-medium uppercase tracking-wide text-muted">{label}</div>
      <div data-testid={testId} className="mt-1 text-2xl font-semibold tabular-nums text-fg">
        {value}
      </div>
      {hint && <div className="mt-1 text-xs text-muted">{hint}</div>}
    </Card>
  );
}
