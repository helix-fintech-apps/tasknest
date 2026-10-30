import type { ReactNode } from "react";

export function Card({
  children,
  className = "",
  ...p
}: { children: ReactNode; className?: string } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      {...p}
      className={`rounded-xl border border-slate-200 bg-white p-5 shadow-sm ${className}`}
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
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div data-testid={testId} className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">
        {value}
      </div>
      {hint && <div className="mt-1 text-xs text-slate-500">{hint}</div>}
    </Card>
  );
}
