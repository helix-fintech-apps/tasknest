import type { ReactNode } from "react";
import { cx } from "./cx";

export type Tone = "info" | "success" | "warning" | "error";
export const toneClasses: Record<Tone, string> = {
  info: "border-info/30 bg-info-bg text-info",
  success: "border-success/30 bg-success-bg text-success",
  warning: "border-warning/30 bg-warning-bg text-warning",
  error: "border-danger/30 bg-danger-bg text-danger",
};

export function Banner({
  tone = "info",
  children,
  testId,
  className = "",
}: {
  tone?: Tone;
  children: ReactNode;
  testId?: string;
  className?: string;
}) {
  return (
    <div
      data-testid={testId}
      role={tone === "error" ? "alert" : "status"}
      className={cx("mb-4 rounded-lg border px-4 py-3 text-sm", toneClasses[tone], className)}
    >
      {children}
    </div>
  );
}
