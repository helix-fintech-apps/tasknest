const badgeTones: Record<string, string> = {
  requested: "bg-amber-100 text-amber-800",
  accepted: "bg-blue-100 text-blue-800",
  in_progress: "bg-indigo-100 text-indigo-800",
  completed: "bg-emerald-100 text-emerald-800",
  disputed: "bg-red-100 text-red-700",
  active: "bg-emerald-100 text-emerald-800",
  pending: "bg-amber-100 text-amber-800",
  suspended: "bg-red-100 text-red-700",
};
export function Badge({ value, testId }: { value: string; testId?: string }) {
  return (
    <span
      data-testid={testId}
      className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium capitalize ${badgeTones[value] ?? "bg-slate-100 text-slate-700"}`}
    >
      {value.replace(/_/g, " ")}
    </span>
  );
}
