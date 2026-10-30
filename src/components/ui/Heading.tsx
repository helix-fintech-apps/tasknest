import type { ReactNode } from "react";

export function H1({
  children,
  sub,
  actions,
}: {
  children: ReactNode;
  sub?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 tabIndex={-1} className="text-3xl font-bold tracking-tight text-fg md:text-4xl">
          {children}
        </h1>
        {sub && <p className="mt-1 text-base text-muted">{sub}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function H2({ children }: { children: ReactNode }) {
  return <h2 className="mb-3 text-xl font-semibold tracking-tight text-fg">{children}</h2>;
}
