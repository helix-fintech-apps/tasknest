import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cx } from "./cx";

type Variant = "primary" | "secondary" | "danger" | "ghost" | "accent";
type Size = "sm" | "md" | "lg";
const variants: Record<Variant, string> = {
  primary: "bg-primary text-on-primary hover:bg-primary-hover disabled:opacity-50",
  accent: "bg-yolk-400 text-twig-900 hover:bg-yolk-300 disabled:opacity-50",
  secondary:
    "border border-line-input bg-surface text-fg hover:bg-surface-muted disabled:text-subtle",
  danger: "border border-danger bg-surface text-danger hover:bg-danger-bg disabled:opacity-50",
  ghost: "text-muted hover:bg-surface-muted hover:text-fg disabled:opacity-50",
};
const sizes: Record<Size, string> = {
  sm: "min-h-9 px-3 text-sm",
  md: "min-h-11 px-4 text-sm",
  lg: "min-h-12 px-6 text-base",
};

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", size = "md", loading = false, className = "", disabled, children, ...p },
  ref,
) {
  return (
    <button
      type="button"
      {...p}
      ref={ref}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cx(
        "inline-flex items-center justify-center gap-2 rounded-lg font-semibold transition-colors disabled:cursor-not-allowed",
        variants[variant],
        sizes[size],
        className,
      )}
    >
      {loading && (
        <span
          aria-hidden="true"
          className="inline-block h-4 w-4 rounded-full border-2 border-current border-t-transparent"
          style={{ animation: "tn-spin 0.7s linear infinite" }}
        />
      )}
      {children}
    </button>
  );
});
