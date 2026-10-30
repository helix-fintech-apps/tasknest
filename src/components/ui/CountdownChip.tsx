import { useEffect, useState } from "react";
import { Clock } from "lucide-react";
import { fmtMinutes } from "../../lib/format";

/** Time left until `until`, ticking every 30 s: "Expires in 2h 14m", then "Expired". */
export function CountdownChip({
  until,
  prefix = "Expires in",
  testId,
}: {
  until: string | Date;
  prefix?: string;
  testId?: string;
}) {
  const end = typeof until === "string" ? new Date(until).getTime() : until.getTime();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  const mins = Math.max(0, Math.ceil((end - now) / 60_000));
  const urgent = mins > 0 && mins <= 60;
  return (
    <span
      data-testid={testId}
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${
        mins === 0
          ? "border-line bg-surface-muted text-muted"
          : urgent
            ? "border-warning/30 bg-warning-bg text-warning"
            : "border-info/30 bg-info-bg text-info"
      }`}
    >
      <Clock size={14} aria-hidden="true" />
      {mins === 0 ? "Expired" : `${prefix} ${fmtMinutes(mins)}`}
    </span>
  );
}
