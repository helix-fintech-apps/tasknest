import { Check, Circle } from "lucide-react";

export interface Requirement {
  id: string;
  label: string;
  met: boolean;
}

/** Why a submit button is disabled: every requirement, with the unmet ones first. */
export function RequirementsList({
  items,
  title = "To continue",
  testId = "requirements",
}: {
  items: Requirement[];
  title?: string;
  testId?: string;
}) {
  const open = items.filter((i) => !i.met);
  if (open.length === 0) return null;
  return (
    <div
      data-testid={testId}
      className="rounded-lg border border-line bg-surface-muted p-3 text-sm text-fg"
    >
      <p className="mb-1 font-semibold">{title}</p>
      <ul className="space-y-1">
        {[...open, ...items.filter((i) => i.met)].map((i) => (
          <li key={i.id} data-met={i.met} className="flex items-start gap-2">
            {i.met ? (
              <Check size={16} aria-hidden="true" className="mt-0.5 shrink-0 text-success" />
            ) : (
              <Circle size={16} aria-hidden="true" className="mt-0.5 shrink-0 text-subtle" />
            )}
            <span className={i.met ? "text-muted line-through" : ""}>
              {i.label}
              <span className="sr-only">{i.met ? " (done)" : " (needed)"}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
