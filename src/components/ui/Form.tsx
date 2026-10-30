import {
  Children,
  cloneElement,
  isValidElement,
  useId,
  type InputHTMLAttributes,
  type ReactElement,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import { cx } from "./cx";

export function Label({ children, htmlFor }: { children: ReactNode; htmlFor?: string }) {
  return (
    <label htmlFor={htmlFor} className="mb-1 block text-sm font-medium text-fg">
      {children}
    </label>
  );
}

const inputCls =
  "min-h-11 w-full rounded-lg border border-line-input bg-surface px-3 py-2 text-base text-fg placeholder:text-subtle focus:border-focus focus:outline-none focus:ring-2 focus:ring-focus/40 aria-[invalid=true]:border-danger md:text-sm";
export const Input = (p: InputHTMLAttributes<HTMLInputElement>) => (
  <input {...p} className={cx(inputCls, p.className)} />
);
/** First option's text, used as a last-resort accessible name for a select nobody labelled. */
function firstOptionText(children: ReactNode): string | undefined {
  const first = Children.toArray(children)[0];
  if (isValidElement(first)) {
    const t = (first as ReactElement<{ children?: ReactNode }>).props.children;
    if (typeof t === "string") return t;
  }
  return undefined;
}

/**
 * A native select. Give it a <Field>/<Label htmlFor>, `aria-label` or `aria-labelledby`. A select with
 * none of those still gets a name (its first option's text) so it is never announced as unnamed.
 */
export const Select = (p: SelectHTMLAttributes<HTMLSelectElement>) => {
  const named = p.id || p["aria-label"] || p["aria-labelledby"];
  return (
    <select
      {...p}
      aria-label={named ? p["aria-label"] : firstOptionText(p.children)}
      className={cx(inputCls, p.className)}
    />
  );
};
export const Textarea = (p: TextareaHTMLAttributes<HTMLTextAreaElement>) => (
  <textarea {...p} className={cx(inputCls, p.className)} />
);

/**
 * A labelled form control. Pass `id` (kept for older call sites) or let Field generate one and wire
 * it into a single child control. `error` and `hint` are linked with aria-describedby.
 */
export function Field({
  label,
  children,
  hint,
  error,
  id,
  required,
}: {
  label: string;
  children: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  id?: string;
  required?: boolean;
}) {
  const auto = useId();
  const fieldId = id ?? auto;
  const hintId = hint ? `${fieldId}-hint` : undefined;
  const errId = error ? `${fieldId}-err` : undefined;
  const describedBy = [hintId, errId].filter(Boolean).join(" ") || undefined;
  let control = children;
  if (isValidElement(children)) {
    const el = children as ReactElement<Record<string, unknown>>;
    control = cloneElement(el, {
      id: el.props.id ?? fieldId,
      "aria-describedby": el.props["aria-describedby"] ?? describedBy,
      "aria-invalid": error ? true : el.props["aria-invalid"],
    });
  }
  return (
    <div className="mb-3">
      <Label htmlFor={id ?? fieldId}>
        {label}
        {required && (
          <span aria-hidden="true" className="text-danger">
            {" "}
            *
          </span>
        )}
      </Label>
      {control}
      {hint && (
        <p id={hintId} className="mt-1 text-xs text-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={errId} role="alert" className="mt-1 text-sm font-medium text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
