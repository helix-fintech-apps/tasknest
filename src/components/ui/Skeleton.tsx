import { cx } from "./cx";

/** A pulsing placeholder block. Hidden from assistive tech; pair with a status message. */
export function Skeleton({ className = "" }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cx("rounded-md bg-surface-muted", className)}
      style={{ animation: "tn-pulse 1.4s ease-in-out infinite" }}
    />
  );
}
