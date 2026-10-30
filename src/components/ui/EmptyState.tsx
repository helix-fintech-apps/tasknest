import type { ReactNode } from "react";

export function EmptyState({
  children,
  title,
  action,
  icon,
}: {
  children?: ReactNode;
  title?: string;
  action?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-dashed border-line-input bg-surface p-8 text-center text-sm text-muted">
      {icon && <div className="mb-2 flex justify-center text-subtle">{icon}</div>}
      {title && <p className="mb-1 text-base font-semibold text-fg">{title}</p>}
      {children}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}

/** Older name for EmptyState, kept so existing pages compile unchanged. */
export const Empty = EmptyState;
