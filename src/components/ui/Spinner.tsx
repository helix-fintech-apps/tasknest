export function Spinner({ label = "Loading…" }: { label?: string }) {
  return (
    <div role="status" className="py-8 text-center text-sm text-muted">
      {label}
    </div>
  );
}
