import { useMemo } from "react";
import { addDays } from "@domain";
import { useAuth } from "../lib/auth";
import { pointsLots, pointsMovements } from "../lib/data";
import { fmtDate, fmtDateTime, money } from "../lib/format";
import { useActivePolicy } from "../lib/policy";
import { pointsSummary } from "../lib/preview";
import { Banner, Card, Empty, H1, H2, Spinner, Stat, useLoad } from "../components/ui";

const EXPIRING_DAYS = 30;

const KIND_LABEL: Record<string, string> = {
  earn: "Earned",
  bonus: "Bonus",
  reserve: "Reserved for booking",
  release: "Released",
  redeem: "Redeemed",
  return: "Returned (refund)",
  clawback: "Clawed back (refund)",
  expire: "Expired",
  reissue: "Reissued",
};

export default function Points() {
  const { profile } = useAuth();
  const { policy } = useActivePolicy();
  const lots = useLoad(() => pointsLots(profile!.id), [profile?.id]);
  const moves = useLoad(() => pointsMovements(profile!.id), [profile?.id]);
  const now = useMemo(() => new Date(), []);

  const summary = pointsSummary(lots.data ?? [], now);
  const mapped = summary.lots;
  const available = summary.availableNet;
  const pending = summary.pending;
  const soon = addDays(now, EXPIRING_DAYS);
  const expiringLots = mapped.filter(
    (l) => l.points > 0 && l.availableAt <= now && l.expiresAt > now && l.expiresAt <= soon,
  );
  const expiring = expiringLots.reduce((a, l) => a + l.points, 0);
  const cpp = policy?.points.centsPerPoint ?? 1;

  return (
    <div>
      <H1
        sub={
          policy
            ? `Earn ${policy.points.pointsPerDollarCash} point per $1 paid by card (excl. tax and tips). Points become available ${policy.points.pendingDays} days after the task and expire after ${policy.points.expiryMonths} months.`
            : undefined
        }
      >
        Points
      </H1>
      {(lots.error || moves.error) && <Banner tone="error">{lots.error ?? moves.error}</Banner>}
      {lots.loading ? (
        <Spinner />
      ) : (
        <>
          <div className="mb-6 grid gap-4 sm:grid-cols-3">
            <Stat
              label="Available"
              value={available.toLocaleString()}
              testId="points-available-total"
              hint={
                summary.debt < 0
                  ? `includes ${summary.debt.toLocaleString()} pts owed from a refund`
                  : `worth ${money(Math.max(0, available) * cpp)}`
              }
            />
            <Stat
              label="Pending"
              value={pending.toLocaleString()}
              testId="points-pending-total"
              hint="not yet spendable"
            />
            <Stat
              label={`Expiring in ${EXPIRING_DAYS} days`}
              value={expiring.toLocaleString()}
              testId="points-expiring-total"
              hint={expiringLots[0] ? `next on ${fmtDate(expiringLots[0].expiresAt)}` : "none"}
            />
          </div>
          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <H2>Point lots</H2>
              {!lots.data?.length ? (
                <Empty>No points yet.</Empty>
              ) : (
                <table data-testid="points-lots">
                  <thead>
                    <tr>
                      <th>Kind</th>
                      <th className="text-right">Points</th>
                      <th>Available</th>
                      <th>Expires</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lots.data
                      .filter((l) => l.points_remaining !== 0)
                      .map((l) => (
                        <tr key={l.id}>
                          <td className="capitalize">{l.kind}</td>
                          <td className="text-right tabular-nums">
                            {l.points_remaining.toLocaleString()}
                            {l.points_remaining !== l.points_initial && (
                              <span className="text-xs text-slate-400"> / {l.points_initial}</span>
                            )}
                          </td>
                          <td>
                            {l.kind === "debt" ? (
                              "Owed"
                            ) : new Date(l.available_at) > now ? (
                              <span className="text-amber-700">{fmtDate(l.available_at)}</span>
                            ) : (
                              "Now"
                            )}
                          </td>
                          <td>{fmtDate(l.expires_at)}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              )}
            </Card>
            <Card>
              <H2>History</H2>
              {!moves.data?.length ? (
                <Empty>No activity yet.</Empty>
              ) : (
                <table data-testid="points-history">
                  <thead>
                    <tr>
                      <th>When</th>
                      <th>Activity</th>
                      <th className="text-right">Points</th>
                    </tr>
                  </thead>
                  <tbody>
                    {moves.data.map((m) => (
                      <tr key={m.id}>
                        <td className="whitespace-nowrap text-slate-500">
                          {fmtDateTime(m.created_at)}
                        </td>
                        <td>{KIND_LABEL[m.kind] ?? m.kind}</td>
                        <td
                          className={`text-right tabular-nums ${m.points >= 0 ? "text-emerald-700" : "text-slate-700"}`}
                        >
                          {m.points > 0 ? "+" : ""}
                          {m.points.toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
