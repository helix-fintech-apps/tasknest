import type { ReactNode } from "react";

type Tone = "info" | "success" | "warning" | "error";
const tones: Record<Tone, string> = {
  info: "border-blue-200 bg-blue-50 text-blue-800",
  success: "border-emerald-200 bg-emerald-50 text-emerald-800",
  warning: "border-amber-200 bg-amber-50 text-amber-900",
  error: "border-red-200 bg-red-50 text-red-700",
};
export function Banner({
  tone = "info",
  children,
  testId,
}: {
  tone?: Tone;
  children: ReactNode;
  testId?: string;
}) {
  return (
    <div
      data-testid={testId}
      role={tone === "error" ? "alert" : "status"}
      className={`mb-4 rounded-lg border px-4 py-3 text-sm ${tones[tone]}`}
    >
      {children}
    </div>
  );
}
