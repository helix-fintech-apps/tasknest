import { clientCancellation, quote, type MoneyPolicy } from "@domain";
import { bps, fmtDateTime, money } from "../lib/format";
import { useActivePolicy } from "../lib/policy";
import { TENDER_LABEL } from "../lib/preview";
import { Banner, Card, H1, H2, Spinner } from "../components/ui";

// Worked example shown next to the rules: a $45/h task booked for 2 hours.
const EX_RATE = 4500;
const EX_MIN = 120;

function curveRows(p: MoneyPolicy) {
  const tiers = [...p.cancellation.tiers].sort((a, z) => z.minHoursBefore - a.minHoursBefore);
  const q = quote(EX_RATE, EX_MIN, p);
  const start = new Date("2030-01-10T12:00:00Z");
  return tiers.map((t, i) => {
    const upper = i > 0 ? tiers[i - 1].minHoursBefore : null;
    const when =
      upper === null
        ? `${t.minHoursBefore} hours or more before start`
        : t.minHoursBefore === 0
          ? `Less than ${upper} hours before start (or after)`
          : `${t.minHoursBefore} to ${upper} hours before start`;
    const rule = t.chargeMinutesOfRate
      ? `Charged ${t.chargeMinutesOfRate} minutes of the tasker's rate (capped at the task subtotal); service fee and tax refunded`
      : `${bps(t.refundBps)} of the total refunded${p.cancellation.serviceFeeRefundable ? " (service fee included)" : " (service fee not refunded)"}`;
    const cancelAt = new Date(start.getTime() - t.minHoursBefore * 3_600_000); // boundary is inclusive
    const o = clientCancellation(
      {
        rateCents: EX_RATE,
        subtotal: q.subtotal,
        serviceFee: q.serviceFee,
        tax: q.tax,
        total: q.total,
        cutoffAnchorAt: start,
      },
      cancelAt,
      p,
    );
    return { when, rule, refund: o.refundCents, fee: o.retainedCents, minHours: t.minHoursBefore };
  });
}

function Row({ k, v, testId }: { k: string; v: React.ReactNode; testId?: string }) {
  return (
    <div className="flex justify-between gap-4 border-b border-slate-100 py-2 text-sm last:border-0">
      <span className="text-slate-600">{k}</span>
      <span className="text-right font-medium text-slate-900" data-testid={testId}>
        {v}
      </span>
    </div>
  );
}

export default function Pricing() {
  const { policy: p, row, loading, source, error } = useActivePolicy();
  if (loading) return <Spinner />;
  if (!p) return <Banner tone="error">Could not load the money policy.</Banner>;
  const ex = quote(EX_RATE, EX_MIN, p);
  const rows = curveRows(p);
  return (
    <div className="mx-auto max-w-4xl">
      <H1
        sub={
          <span data-testid="policy-version">
            Policy version {p.version}
            {row && ` · effective ${fmtDateTime(row.effective_from)}`}. Bookings are always settled
            under the policy version in effect when they were made.
          </span>
        }
      >
        Pricing & policies
      </H1>
      {source === "builtin" && (
        <Banner tone="warning" testId="policy-fallback">
          Showing the built-in copy of policy v{p.version} because the live policy table could not
          be read ({error}).
        </Banner>
      )}

      <div className="grid gap-6 md:grid-cols-2">
        <Card data-testid="pricing-fees">
          <H2>Fees</H2>
          <Row
            k="Client service fee"
            v={`${bps(p.clientServiceFeeBps)} of the task subtotal`}
            testId="fee-client"
          />
          <Row
            k="Tasker commission"
            v={`${bps(p.taskerCommissionBps)} of the task subtotal`}
            testId="fee-commission"
          />
          <Row
            k="Tax"
            v={p.taxBps ? `${bps(p.taxBps)} of subtotal + service fee` : "None"}
            testId="fee-tax"
          />
          <Row
            k="Card authorization"
            v={`Held at booking, captured on completion (valid ${p.auth.validityDays} days)`}
          />
          <p className="mt-3 text-xs text-slate-500">Amounts are rounded half-up to the cent.</p>
        </Card>
        <Card data-testid="pricing-example">
          <H2>Example: {money(EX_RATE)}/h for 2 hours</H2>
          <Row k="Task subtotal" v={money(ex.subtotal)} testId="example-subtotal" />
          <Row
            k={`Service fee (${bps(p.clientServiceFeeBps)})`}
            v={money(ex.serviceFee)}
            testId="example-fee"
          />
          <Row k="Tax" v={money(ex.tax)} />
          <Row k="Client pays" v={money(ex.total)} testId="example-total" />
          <Row
            k={`Tasker earns (after ${bps(p.taskerCommissionBps)} commission)`}
            v={money(ex.taskerNet)}
            testId="example-tasker-net"
          />
        </Card>
      </div>

      <Card className="mt-6" data-testid="pricing-curve">
        <H2>Cancellation by the client</H2>
        <p className="mb-3 text-sm text-slate-600">
          Measured from the <strong>original</strong> start time — rescheduling does not reset the
          clock. The boundary hour counts toward the more generous tier.
        </p>
        <div className="overflow-x-auto">
          <table>
            <thead>
              <tr>
                <th>When you cancel</th>
                <th>What happens</th>
                <th className="text-right">Example refund</th>
                <th className="text-right">Example fee</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.minHours} data-testid="curve-row" data-min-hours={r.minHours}>
                  <td className="font-medium text-slate-900">{r.when}</td>
                  <td className="text-slate-600">{r.rule}</td>
                  <td className="text-right tabular-nums" data-testid="curve-refund">
                    {money(r.refund)}
                  </td>
                  <td className="text-right tabular-nums" data-testid="curve-fee">
                    {money(r.fee)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-slate-500">
          Examples use the {money(ex.total)} booking above. Client no-show:{" "}
          {bps(p.cancellation.noShowRefundBps)} refunded. Any fee kept is taken from your card
          first, then{" "}
          {p.retentionOrder
            .slice(1)
            .map((t) => TENDER_LABEL[t].toLowerCase())
            .join(", then ")}
          .
        </p>
      </Card>

      <div className="mt-6 grid gap-6 md:grid-cols-2">
        <Card data-testid="pricing-tasker-cancel">
          <H2>Cancellation by the tasker</H2>
          <Row k="Client refund" v="100%, including fees" />
          <Row
            k="Tasker fee"
            v={money(p.taskerPenalty.cancelFeeCents)}
            testId="tasker-cancel-fee"
          />
          <Row
            k="Strikes"
            v={`${p.taskerPenalty.strikesToSuspend} in ${p.taskerPenalty.strikeWindowDays} days → suspension`}
            testId="tasker-strikes-rule"
          />
        </Card>
        <Card data-testid="pricing-tips">
          <H2>Tips</H2>
          <Row
            k="Goes to tasker"
            v={`${bps(10_000 - p.tips.platformFeeBps)}`}
            testId="tips-share"
          />
          <Row
            k="Maximum"
            v={`${bps(p.tips.capBpsOfSubtotal)} of the task subtotal`}
            testId="tips-cap"
          />
          <Row
            k="Window"
            v={`Within ${p.tips.windowDays} days of completion`}
            testId="tips-window"
          />
          <Row
            k="Paid with"
            v={p.tips.allowedTenders.map((t) => TENDER_LABEL[t]).join(", ") + " only"}
            testId="tips-tenders"
          />
        </Card>
        <Card data-testid="pricing-points">
          <H2>Points</H2>
          <Row
            k="Earn rate"
            v={`${p.points.pointsPerDollarCash} point per $1 paid by card (excl. tax & tips)`}
            testId="points-earn"
          />
          <Row k="Value" v={`1 point = ${money(p.points.centsPerPoint)}`} testId="points-value" />
          <Row
            k="Minimum redemption"
            v={`${p.points.minRedeemPoints.toLocaleString()} points`}
            testId="points-min"
          />
          <Row k="Maximum per booking" v={`${bps(p.points.maxRedeemBpsOfTotal)} of the total`} />
          <Row
            k="Pending period"
            v={`${p.points.pendingDays} days after completion`}
            testId="points-pending"
          />
          <Row
            k="Expiry"
            v={`${p.points.expiryMonths} months after they become available`}
            testId="points-expiry"
          />
          <Row
            k="Refunded points that already expired"
            v={`Reissued, valid ${p.points.reissueDaysOnExpiredRefund} days`}
          />
          <Row k="Review bonus" v={`${p.points.reviewBonusPoints} points, once per booking`} />
          <Row
            k="Refunds of card payments"
            v="Points earned on the refunded amount are taken back"
          />
        </Card>
        <Card data-testid="pricing-refunds">
          <H2>Payments & refunds</H2>
          <Row
            k="Payment order at checkout"
            v={p.tenderUseOrder.map((t) => TENDER_LABEL[t]).join(" → ")}
            testId="tender-order"
          />
          <Row
            k="Refund order"
            v={p.refundOrder.map((t) => TENDER_LABEL[t]).join(" → ")}
            testId="refund-order"
          />
          <Row
            k="Refund window"
            v={`${p.refunds.windowDays} days after completion`}
            testId="refund-window"
          />
          <Row
            k="Support agent limit"
            v={`${money(p.refunds.agentLimitCents)} without admin approval`}
            testId="refund-agent-limit"
          />
          <Row
            k="Tasker payouts"
            v={`${p.payouts.holdDays} days after completion, once funds settle`}
            testId="payout-hold"
          />
          <Row k="Tasker response time" v={`${p.booking.taskerResponseHours} hours`} />
        </Card>
      </div>
    </div>
  );
}
