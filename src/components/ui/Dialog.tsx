import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from "react";
import { X } from "lucide-react";
import { cx } from "./cx";

export type DialogPlacement = "center" | "bottom" | "right";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Keep Tab and Shift+Tab inside the dialog (browsers let focus escape a native modal to their own UI). */
function trapTab(e: KeyboardEvent<HTMLDialogElement>) {
  if (e.key !== "Tab") return;
  const items = Array.from(e.currentTarget.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => el.offsetParent !== null || el === document.activeElement,
  );
  if (items.length === 0) {
    e.preventDefault();
    return;
  }
  const first = items[0];
  const last = items[items.length - 1];
  const active = document.activeElement;
  if (e.shiftKey && (active === first || active === e.currentTarget)) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && active === last) {
    e.preventDefault();
    first.focus();
  }
}

/**
 * A modal built on the native <dialog> element opened with showModal(): the browser traps focus,
 * makes everything behind it inert, closes on Esc and (here) on a backdrop click. We also return
 * focus to whatever opened it. Mount it to open it, unmount it to close it.
 */
export function Dialog({
  title,
  children,
  onClose,
  testId,
  placement = "center",
  description,
  footer,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  testId?: string;
  placement?: DialogPlacement;
  description?: string;
  footer?: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const opener = document.activeElement as HTMLElement | null;
    if (!el.open) el.showModal();
    // Esc fires `cancel`; keep React in charge of unmounting.
    const onCancel = (e: Event) => {
      e.preventDefault();
      closeRef.current();
    };
    el.addEventListener("cancel", onCancel);
    return () => {
      el.removeEventListener("cancel", onCancel);
      if (el.open) el.close();
      if (opener && opener.isConnected) opener.focus();
    };
  }, []);

  const place: Record<DialogPlacement, string> = {
    center: "m-auto max-h-[90dvh] w-[calc(100%-2rem)] max-w-lg rounded-2xl",
    bottom:
      "mx-auto mb-0 mt-auto max-h-[92dvh] w-full max-w-lg rounded-t-2xl md:mb-auto md:rounded-2xl",
    right: "mb-0 ml-auto mr-0 mt-0 h-dvh max-h-dvh w-full max-w-md rounded-l-2xl",
  };

  return (
    <dialog
      ref={ref}
      data-testid={testId}
      aria-labelledby={titleId}
      aria-describedby={description ? `${titleId}-d` : undefined}
      className={cx(
        "overflow-auto border border-line bg-surface p-0 text-fg shadow-[var(--shadow-3)] backdrop:bg-black/50",
        place[placement],
      )}
      onClick={(e) => {
        if (e.target === ref.current) closeRef.current();
      }}
      onKeyDown={trapTab}
    >
      <div className="p-5 md:p-6">
        <div className="mb-4 flex items-start justify-between gap-4">
          <h2 id={titleId} className="font-display text-xl font-semibold text-fg">
            {title}
          </h2>
          <button
            type="button"
            aria-label="Close"
            className="-mr-2 -mt-2 inline-flex h-10 w-10 items-center justify-center rounded-lg text-muted hover:bg-surface-muted hover:text-fg"
            onClick={onClose}
          >
            <X size={20} aria-hidden="true" />
          </button>
        </div>
        {description && (
          <p id={`${titleId}-d`} className="mb-3 text-sm text-muted">
            {description}
          </p>
        )}
        {children}
        {footer && <div className="mt-5 flex flex-wrap justify-end gap-2">{footer}</div>}
      </div>
    </dialog>
  );
}

/** Older name, kept so existing pages compile unchanged. */
export function Modal(p: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  testId?: string;
}) {
  return <Dialog {...p} />;
}

/** A panel that slides in from the side (desktop) or rises from the bottom (phone). */
export function Sheet({
  side = "bottom",
  ...p
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  testId?: string;
  description?: string;
  footer?: ReactNode;
  side?: "bottom" | "right";
}) {
  return <Dialog {...p} placement={side} />;
}
