import type { MoneyKind } from "./Money";
import { Money } from "./Money";
import { Banner } from "./Banner";

export type ReconcileLine = { key: string; label: string; cents: number; kind?: MoneyKind };

/**
 * Compares what the client was shown (the preview) with what the server settled (the result).
 * Equal lines read "Settled as previewed"; otherwise a table shows each difference in cents.
 */
export function ReconcileBanner({
  preview,
  result,
  testId = "reconcile-banner",
}: {
  preview: ReconcileLine[];
  result: ReconcileLine[];
  testId?: string;
}) {
  const byKey = new Map(preview.map((l) => [l.key, l]));
  const keys = [...new Set([...preview.map((l) => l.key), ...result.map((l) => l.key)])];
  const rows = keys.map((k) => {
    const a = byKey.get(k);
    const b = result.find((l) => l.key === k);
    return {
      key: k,
      label: (b ?? a)!.label,
      kind: (b ?? a)!.kind ?? "total",
      before: a?.cents ?? 0,
      after: b?.cents ?? 0,
    };
  });
  const diffs = rows.filter((r) => r.before !== r.after);
  if (diffs.length === 0)
    return (
      <Banner tone="success" testId={testId}>
        Settled as previewed.
      </Banner>
    );
  return (
    <Banner tone="warning" testId={testId}>
      <p className="mb-2 font-semibold">The final amounts differ from the preview</p>
      <table className="text-sm">
        <caption className="sr-only">Preview versus settled amounts</caption>
        <thead>
          <tr>
            <th scope="col">Line</th>
            <th scope="col">Previewed</th>
            <th scope="col">Settled</th>
          </tr>
        </thead>
        <tbody>
          {diffs.map((r) => (
            <tr key={r.key}>
              <td>{r.label}</td>
              <td>
                <Money cents={r.before} kind={r.kind} />
              </td>
              <td>
                <Money cents={r.after} kind={r.kind} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Banner>
  );
}
