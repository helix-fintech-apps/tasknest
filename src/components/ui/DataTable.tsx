import type { HTMLAttributes, ReactNode } from "react";
import { EmptyState } from "./EmptyState";
import { cx } from "./cx";

export interface Column<T> {
  key: string;
  header: string;
  cell: (row: T) => ReactNode;
  align?: "left" | "right";
  /** Label shown beside the value when the row is restyled as a card on phones. Defaults to header. */
  mobileLabel?: string;
  /** Hide the header text visually but keep it for screen readers (e.g. an actions column). */
  srOnlyHeader?: boolean;
}

/**
 * Always renders a real <table>. Under the `md` breakpoint CSS turns each <tr> into a stacked card
 * (td shows its data-label), so row selectors in tests keep matching at every width.
 * `rowProps` adds attributes to each <tr> (data-testid, data-booking-id, ...).
 */
export function DataTable<T>({
  caption,
  columns,
  rows,
  rowKey,
  rowProps,
  empty,
  testId,
  className = "",
}: {
  caption: string;
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  rowProps?: (
    row: T,
  ) => HTMLAttributes<HTMLTableRowElement> & Record<`data-${string}`, string | undefined>;
  empty?: ReactNode;
  testId?: string;
  className?: string;
}) {
  if (rows.length === 0 && empty) return <EmptyState>{empty}</EmptyState>;
  return (
    <div
      className={cx("tn-scroll rounded-xl border border-line bg-surface md:border-line", className)}
      role="region"
      aria-label={caption}
      tabIndex={0}
    >
      <table data-testid={testId} className="tn-cards">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} scope="col" className={cx(c.align === "right" && "text-right")}>
                {c.srOnlyHeader ? <span className="sr-only">{c.header}</span> : c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={rowKey(row)} {...rowProps?.(row)}>
              {columns.map((c) => (
                <td
                  key={c.key}
                  data-label={c.srOnlyHeader ? undefined : (c.mobileLabel ?? c.header)}
                  className={cx(c.align === "right" && "text-right tabular-nums")}
                >
                  {c.cell(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
