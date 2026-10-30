import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { X } from "lucide-react";
import { onIdempotentReplay } from "../../lib/api/core";
import { cx } from "./cx";
import { toneClasses, type Tone } from "./Banner";

export type ToastKind = "flash" | "refund-flash";
interface ToastItem {
  id: number;
  message: ReactNode;
  tone: Tone;
  kind: ToastKind;
}
interface ToastApi {
  /** Show a toast. `kind` sets the test id: `flash` (default) or `refund-flash`. */
  show: (message: ReactNode, opts?: { tone?: Tone; kind?: ToastKind; ms?: number }) => number;
  dismiss: (id: number) => void;
}

const Ctx = createContext<ToastApi | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const next = useRef(1);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: number) => {
    setItems((xs) => xs.filter((x) => x.id !== id));
    const t = timers.current.get(id);
    if (t) clearTimeout(t);
    timers.current.delete(id);
  }, []);

  const show = useCallback<ToastApi["show"]>(
    (message, opts) => {
      const id = next.current++;
      setItems((xs) => [
        ...xs.slice(-3),
        { id, message, tone: opts?.tone ?? "success", kind: opts?.kind ?? "flash" },
      ]);
      timers.current.set(
        id,
        setTimeout(() => dismiss(id), opts?.ms ?? 8000),
      );
      return id;
    },
    [dismiss],
  );

  // "Already done earlier": the API replayed a stored answer for a repeated Idempotency-Key.
  useEffect(
    () =>
      onIdempotentReplay(() => {
        show("Already done earlier. Nothing was charged or changed a second time.", {
          tone: "info",
          ms: 6000,
        });
      }),
    [show],
  );
  useEffect(() => {
    const t = timers.current;
    return () => t.forEach((x) => clearTimeout(x));
  }, []);

  const api = useMemo(() => ({ show, dismiss }), [show, dismiss]);
  return (
    <Ctx.Provider value={api}>
      {children}
      <div
        aria-label="Notifications"
        role="region"
        className="pointer-events-none fixed inset-x-0 top-16 z-[60] mx-auto flex w-full max-w-md flex-col gap-2 px-4 md:left-auto md:right-4 md:mx-0"
      >
        {items.map((t) => (
          <div
            key={t.id}
            role={t.tone === "error" ? "alert" : "status"}
            data-testid={t.kind}
            className={cx(
              "pointer-events-auto flex items-start gap-3 rounded-xl border px-4 py-3 text-sm shadow-[var(--shadow-3)]",
              "bg-surface",
              toneClasses[t.tone],
            )}
          >
            <div className="min-w-0 flex-1 break-words">{t.message}</div>
            <button
              type="button"
              aria-label="Dismiss"
              className="-mr-1 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md hover:bg-black/5"
              onClick={() => dismiss(t.id)}
            >
              <X size={16} aria-hidden="true" />
            </button>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export function useToast(): ToastApi {
  const v = useContext(Ctx);
  if (!v) throw new Error("useToast outside ToastProvider");
  return v;
}
