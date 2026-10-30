import { useRef, type KeyboardEvent, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { cx } from "./cx";

export interface TabDef {
  id: string;
  label: string;
  count?: number;
  testId?: string;
}

/**
 * URL-synced tabs: the active tab lives in ?<param>=<id> so it survives reload and back/forward.
 * Roving tabindex + arrow/Home/End keys, as in the WAI-ARIA tabs pattern.
 */
export function Tabs({
  tabs,
  param = "tab",
  label,
  children,
}: {
  tabs: TabDef[];
  param?: string;
  label: string;
  children: (activeId: string) => ReactNode;
}) {
  const [params, setParams] = useSearchParams();
  const wanted = params.get(param);
  const active = tabs.find((t) => t.id === wanted)?.id ?? tabs[0]?.id ?? "";
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});

  const select = (id: string, focus = false) => {
    const next = new URLSearchParams(params);
    if (id === tabs[0]?.id) next.delete(param);
    else next.set(param, id);
    setParams(next, { replace: true });
    if (focus) refs.current[id]?.focus();
  };
  const onKey = (e: KeyboardEvent, i: number) => {
    const last = tabs.length - 1;
    const to =
      e.key === "ArrowRight"
        ? (i + 1) % tabs.length
        : e.key === "ArrowLeft"
          ? (i - 1 + tabs.length) % tabs.length
          : e.key === "Home"
            ? 0
            : e.key === "End"
              ? last
              : -1;
    if (to < 0) return;
    e.preventDefault();
    select(tabs[to].id, true);
  };

  return (
    <div>
      <div
        role="tablist"
        aria-label={label}
        className="mb-4 flex gap-1 overflow-x-auto border-b border-line"
      >
        {tabs.map((t, i) => {
          const on = t.id === active;
          return (
            <button
              key={t.id}
              ref={(el) => {
                refs.current[t.id] = el;
              }}
              type="button"
              role="tab"
              id={`tab-${param}-${t.id}`}
              aria-selected={on}
              aria-controls={`panel-${param}-${t.id}`}
              tabIndex={on ? 0 : -1}
              data-testid={t.testId ?? `tab-${t.id}`}
              onClick={() => select(t.id)}
              onKeyDown={(e) => onKey(e, i)}
              className={cx(
                "-mb-px min-h-11 whitespace-nowrap border-b-2 px-4 text-sm font-semibold",
                on ? "border-primary text-link" : "border-transparent text-muted hover:text-fg",
              )}
            >
              {t.label}
              {t.count !== undefined && (
                <span className="ml-2 rounded-full bg-surface-muted px-2 py-0.5 text-xs tabular-nums text-muted">
                  {t.count}
                </span>
              )}
            </button>
          );
        })}
      </div>
      <div
        role="tabpanel"
        id={`panel-${param}-${active}`}
        aria-labelledby={`tab-${param}-${active}`}
        tabIndex={0}
      >
        {children(active)}
      </div>
    </div>
  );
}
