import { useId } from "react";
import { Star } from "lucide-react";

/** Display: "4.8 out of 5" with filled stars (the number is always shown). */
export function RatingStars({
  value,
  count,
  size = 16,
  onChange,
  name,
  label = "Rating",
}: {
  value: number;
  count?: number;
  size?: number;
  /** Provide onChange to make it a radio-group input. */
  onChange?: (v: number) => void;
  name?: string;
  label?: string;
}) {
  const auto = useId();
  if (onChange) {
    const group = name ?? auto;
    return (
      <fieldset className="m-0 border-0 p-0" data-testid="rating-input">
        <legend className="sr-only">{label}</legend>
        <div className="flex gap-1">
          {[1, 2, 3, 4, 5].map((n) => (
            <label
              key={n}
              className="cursor-pointer rounded-md p-1 has-[:focus-visible]:outline has-[:focus-visible]:outline-[3px] has-[:focus-visible]:outline-focus"
            >
              <input
                type="radio"
                name={group}
                value={n}
                checked={Math.round(value) === n}
                onChange={() => onChange(n)}
                className="sr-only"
                aria-label={`${n} ${n === 1 ? "star" : "stars"}`}
              />
              <Star
                size={size + 8}
                aria-hidden="true"
                className={n <= value ? "fill-rating text-rating" : "text-line-input"}
              />
            </label>
          ))}
        </div>
      </fieldset>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-sm" data-testid="rating-display">
      <Star size={size} aria-hidden="true" className="fill-rating text-rating" />
      <span className="font-semibold tabular-nums text-fg">{value.toFixed(1)}</span>
      <span className="sr-only"> out of 5</span>
      {count !== undefined && <span className="text-muted">({count})</span>}
    </span>
  );
}
