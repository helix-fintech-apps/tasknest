import { useEffect, useId, useMemo, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { cx } from "./cx";

export interface ComboOption {
  value: string;
  label: string;
}

/** An editable combobox with a filtered listbox (WAI-ARIA 1.2): type to filter, arrows to move. */
export function Combobox({
  label,
  options,
  value,
  onChange,
  placeholder,
  testId,
  id,
}: {
  label: string;
  options: ComboOption[];
  value: string | null;
  onChange: (value: string | null) => void;
  placeholder?: string;
  testId?: string;
  id?: string;
}) {
  const auto = useId();
  const inputId = id ?? `${auto}-input`;
  const listId = `${auto}-list`;
  const selected = options.find((o) => o.value === value) ?? null;
  const [text, setText] = useState(selected?.label ?? "");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => setText(selected?.label ?? ""), [selected?.label]);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [open]);

  const shown = useMemo(() => {
    const q = text.trim().toLowerCase();
    if (!q || q === selected?.label.toLowerCase()) return options;
    return options.filter((o) => o.label.toLowerCase().includes(q));
  }, [options, text, selected?.label]);

  const pick = (o: ComboOption) => {
    onChange(o.value);
    setText(o.label);
    setOpen(false);
  };

  return (
    <div ref={wrap} className="relative">
      <label htmlFor={inputId} className="mb-1 block text-sm font-medium text-fg">
        {label}
      </label>
      <div className="relative">
        <input
          id={inputId}
          data-testid={testId}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && shown[active] ? `${listId}-${active}` : undefined}
          autoComplete="off"
          placeholder={placeholder}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setOpen(true);
            setActive(0);
            if (!e.target.value) onChange(null);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setOpen(true);
              setActive((a) => Math.min(a + 1, shown.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => Math.max(a - 1, 0));
            } else if (e.key === "Enter" && open && shown[active]) {
              e.preventDefault();
              pick(shown[active]);
            } else if (e.key === "Escape" && open) {
              e.stopPropagation();
              setOpen(false);
            }
          }}
          className="min-h-11 w-full rounded-lg border border-line-input bg-surface py-2 pl-3 pr-9 text-base text-fg placeholder:text-subtle focus:border-focus focus:outline-none focus:ring-2 focus:ring-focus/40 md:text-sm"
        />
        <ChevronDown
          size={18}
          aria-hidden="true"
          className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted"
        />
      </div>
      {open && (
        <ul
          id={listId}
          role="listbox"
          aria-label={label}
          className="absolute z-30 mt-1 max-h-60 w-full overflow-auto rounded-lg border border-line bg-surface py-1 shadow-[var(--shadow-2)]"
        >
          {shown.length === 0 && <li className="px-3 py-2 text-sm text-muted">No matches</li>}
          {shown.map((o, i) => (
            <li
              key={o.value}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={o.value === value}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(o);
              }}
              onMouseEnter={() => setActive(i)}
              className={cx(
                "cursor-pointer px-3 py-2 text-sm text-fg",
                i === active && "bg-surface-muted",
                o.value === value && "font-semibold",
              )}
            >
              {o.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
