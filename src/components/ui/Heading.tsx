import type { ReactNode } from "react";

export function H1({ children, sub }: { children: ReactNode; sub?: ReactNode }) {
  return (
    <div className="mb-6">
      <h1 className="text-2xl font-semibold text-slate-900">{children}</h1>
      {sub && <p className="mt-1 text-sm text-slate-500">{sub}</p>}
    </div>
  );
}

export function H2({ children }: { children: ReactNode }) {
  return <h2 className="mb-3 text-lg font-semibold text-slate-900">{children}</h2>;
}
