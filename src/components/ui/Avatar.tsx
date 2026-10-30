import { cx } from "./cx";

const palette = [
  "bg-dusk-100 text-dusk-800",
  "bg-yolk-50 text-yolk-800",
  "bg-twig-100 text-twig-800",
];

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return (
    (parts[0]?.[0] ?? "?") + (parts.length > 1 ? parts[parts.length - 1][0] : "")
  ).toUpperCase();
}

/** Initials in a coloured circle (no stock photos). The colour is stable per name. */
export function Avatar({
  name,
  size = 40,
  className = "",
  decorative = false,
}: {
  name: string;
  size?: number;
  className?: string;
  /** Hide from assistive tech when the name is already shown next to it. */
  decorative?: boolean;
}) {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) % 997;
  return (
    <span
      role={decorative ? undefined : "img"}
      aria-label={decorative ? undefined : name}
      aria-hidden={decorative || undefined}
      style={{ width: size, height: size, fontSize: Math.max(11, size * 0.38) }}
      className={cx(
        "inline-flex shrink-0 items-center justify-center rounded-full font-semibold",
        palette[h % palette.length],
        className,
      )}
    >
      {decorative ? (
        // No text node at all: the initials come from CSS, so they are not part of the button's
        // visible label (axe label-content-name-mismatch) and are not read aloud.
        <span aria-hidden="true" data-initials={initials(name)} className="tn-initials" />
      ) : (
        <span aria-hidden="true">{initials(name)}</span>
      )}
    </span>
  );
}
