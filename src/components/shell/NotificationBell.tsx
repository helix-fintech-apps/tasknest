import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Bell } from "lucide-react";
import { supabase, type NotificationRow } from "../../lib/supabase";
import { fmtDateTime } from "../../lib/format";

/** Bell with an unread count and a short list. Reads the signed-in user's own `notifications` rows. */
export function NotificationBell({ userId }: { userId: string }) {
  const [rows, setRows] = useState<NotificationRow[]>([]);
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from("notifications")
      .select("id, kind, booking_id, title, body, read_at, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(10);
    if (!error && data) setRows(data as NotificationRow[]);
  }, [userId]);

  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  const unread = rows.filter((r) => !r.read_at).length;
  const markAllRead = async () => {
    const ids = rows.filter((r) => !r.read_at).map((r) => r.id);
    if (!ids.length) return;
    const at = new Date().toISOString();
    setRows((rs) => rs.map((r) => (r.read_at ? r : { ...r, read_at: at })));
    await supabase.from("notifications").update({ read_at: at }).in("id", ids);
  };

  return (
    <div ref={wrap} className="relative">
      <button
        type="button"
        data-testid="notification-bell"
        aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"}
        aria-expanded={open}
        onClick={() => {
          setOpen((o) => !o);
          if (!open) void load();
        }}
        className="relative inline-flex h-11 w-11 items-center justify-center rounded-lg text-muted hover:bg-surface-muted hover:text-fg"
      >
        <Bell size={20} aria-hidden="true" />
        {unread > 0 && (
          <span
            data-testid="notification-count"
            aria-hidden="true"
            className="absolute right-1 top-1 inline-flex min-w-5 items-center justify-center rounded-full bg-danger px-1 text-[11px] font-bold leading-5 text-surface"
          >
            {unread}
          </span>
        )}
      </button>
      {open && (
        <div
          role="region"
          aria-label="Notifications"
          className="absolute right-0 top-full z-40 mt-2 w-80 max-w-[calc(100vw-2rem)] rounded-xl border border-line bg-surface p-2 shadow-[var(--shadow-3)]"
        >
          <div className="flex items-center justify-between px-2 py-1">
            <strong className="text-sm">Notifications</strong>
            <button
              type="button"
              className="rounded px-2 py-1 text-xs font-semibold text-link hover:underline disabled:text-subtle"
              disabled={unread === 0}
              onClick={() => void markAllRead()}
            >
              Mark all read
            </button>
          </div>
          {rows.length === 0 ? (
            <p className="px-2 py-4 text-center text-sm text-muted">You are all caught up.</p>
          ) : (
            <ul className="max-h-80 overflow-auto">
              {rows.map((r) => (
                <li key={r.id} className="rounded-lg px-2 py-2 hover:bg-surface-muted">
                  <p className={`text-sm ${r.read_at ? "text-muted" : "font-semibold text-fg"}`}>
                    {r.booking_id ? (
                      <Link to={`/bookings?id=${r.booking_id}`} onClick={() => setOpen(false)}>
                        {r.title}
                      </Link>
                    ) : (
                      r.title
                    )}
                  </p>
                  {r.body && <p className="text-xs text-muted">{r.body}</p>}
                  <p className="text-xs text-subtle">{fmtDateTime(r.created_at)}</p>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
