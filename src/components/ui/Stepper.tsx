import { Check } from "lucide-react";
import { cx } from "./cx";

export interface Step {
  id: string;
  label: string;
}

/** A numbered progress list for multi-step flows (booking, onboarding). */
export function Stepper({
  steps,
  current,
  label = "Progress",
}: {
  steps: Step[];
  current: string;
  label?: string;
}) {
  const idx = Math.max(
    0,
    steps.findIndex((s) => s.id === current),
  );
  return (
    <nav aria-label={label}>
      <ol className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
        {steps.map((s, i) => {
          const done = i < idx;
          const on = i === idx;
          return (
            <li
              key={s.id}
              aria-current={on ? "step" : undefined}
              data-state={done ? "done" : on ? "current" : "todo"}
              className="flex items-center gap-2"
            >
              <span
                className={cx(
                  "inline-flex h-7 w-7 items-center justify-center rounded-full border text-xs font-bold tabular-nums",
                  done && "border-primary bg-primary text-on-primary",
                  on && "border-primary text-link",
                  !done && !on && "border-line-input text-muted",
                )}
              >
                {done ? <Check size={14} aria-hidden="true" /> : i + 1}
              </span>
              <span className={cx(on ? "font-semibold text-fg" : "text-muted")}>
                {s.label}
                {done && <span className="sr-only"> (done)</span>}
              </span>
              {i < steps.length - 1 && (
                <span
                  aria-hidden="true"
                  className="mx-1 hidden h-px w-6 bg-line-input sm:inline-block"
                />
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
