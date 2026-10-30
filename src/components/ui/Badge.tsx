const badgeTones: Record<string, string> = {
  requested: "bg-warning-bg text-warning",
  accepted: "bg-info-bg text-info",
  in_progress: "bg-info-bg text-info",
  completed: "bg-success-bg text-success",
  disputed: "bg-danger-bg text-danger",
  active: "bg-success-bg text-success",
  pending: "bg-warning-bg text-warning",
  suspended: "bg-danger-bg text-danger",
};
export function Badge({ value, testId }: { value: string; testId?: string }) {
  return (
    <span
      data-testid={testId}
      className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium capitalize ${badgeTones[value] ?? "bg-surface-muted text-muted"}`}
    >
      {value.replace(/_/g, " ")}
    </span>
  );
}
