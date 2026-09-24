import { useState } from "react";
import { applyBps, laborCents, type MoneyPolicy } from "@domain";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import {
  getTasker,
  myBookings,
  taskerBalance,
  taskerPayouts,
  taskerStrikes,
  type BookingBundle,
} from "../lib/data";
import { fmtDate, fmtDateTime, fmtMinutes, money, parseDollars } from "../lib/format";
import { usePolicies } from "../lib/policy";
import { previewTaskerCancel, TENDER_LABEL } from "../lib/preview";
import {
  Badge,
  Banner,
  Button,
  Card,
  Empty,
  Field,
  H1,
  H2,
  Input,
  Modal,
  MoneyRow,
  Spinner,
  Stat,
  useAction,
  useLoad,
} from "../components/ui";
import { RescheduleDialog, TenderBreakdown } from "./MyBookings";

type Dialog = { kind: "complete" | "cancel" | "reschedule"; x: BookingBundle } | null;

export default function TaskerDashboard() {
  const { profile } = useAuth();
  const me = profile!.id;
  const tasker = useLoad(() => getTasker(me), [me]);
  const bookings = useLoad(() => myBookings(me, "tasker"), [me]);
  const payouts = useLoad(() => taskerPayouts(me), [me]);
  const strikes = useLoad(() => taskerStrikes(me), [me]);
  const balance = useLoad(() => taskerBalance(me), [me]);
  const policies = usePolicies();
  const active = policies.active?.policy ?? null;
  const [dialog, setDialog] = useState<Dialog>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const reloadAll = () => {
    bookings.reload();
    balance.reload();
    strikes.reload();
    tasker.reload();
    payouts.reload();
  };
  const done = (m: string) => {
    setDialog(null);
    setFlash(m);
    reloadAll();
  };
  const accept = useAction((key: string, id: string) => api.accept(id, key));
  const decline = useAction((key: string, id: string) => api.decline(id, key));
  const start = useAction((key: string, id: string) => api.start(id, key));

  const all = bookings.data ?? [];
  const requests = all.filter((x) => x.booking.status === "requested");
  const upcoming = all.filter((x) => ["accepted", "in_progress"].includes(x.booking.status));
  const history = all.filter(
    (x) => !["requested", "accepted", "in_progress"].includes(x.booking.status),
  );
  const completed = all.filter((x) => x.booking.status === "completed");

  const earnings = completed.reduce((a, x) => {
    const p = policies.policyFor(x.booking.policy_version);
    const sub = Number(x.booking.subtotal_cents);
    return a + (p ? sub - applyBps(sub, p.taskerCommissionBps) : 0);
  }, 0);
  const tips = all.reduce((a, x) => a + x.tips.reduce((s, t) => s + Number(t.amount_cents), 0), 0);
  const paidOut = (payouts.data ?? [])
    .filter((p) => p.status === "paid")
    .reduce((a, p) => a + Number(p.amount_cents), 0);
  const windowDays = active?.taskerPenalty.strikeWindowDays ?? 30;
  const recentStrikes = (strikes.data ?? []).filter(
    (s) => Date.now() - new Date(s.created_at).getTime() <= windowDays * 86_400_000,
  ).length;
  const t = tasker.data;
  const err = accept.error ?? decline.error ?? start.error;

  return (
    <div>
      <H1 sub={t ? `${t.category} · ${money(t.hourly_rate_cents)}/h` : undefined}>
        Tasker dashboard
      </H1>
      {t?.status === "pending" && (
        <Banner tone="warning" testId="tasker-status-banner">
          Your account is pending verification (KYC). You'll appear in search and can accept
          bookings once you're verified.
        </Banner>
      )}
      {t?.status === "suspended" && (
        <Banner tone="error" testId="tasker-status-banner">
          Your account is suspended{t.suspended_at ? ` since ${fmtDate(t.suspended_at)}` : ""}. You
          can't receive new bookings or payouts. Contact support.
        </Banner>
      )}
      {flash && (
        <Banner tone="success" testId="flash">
          {flash}
        </Banner>
      )}
      {err && (
        <Banner tone="error" testId="action-error">
          {err}
        </Banner>
      )}
      {bookings.error && <Banner tone="error">{bookings.error}</Banner>}

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Balance"
          value={balance.data === null || balance.loading ? "—" : money(balance.data)}
          testId="tasker-balance"
          hint="owed to you (ledger)"
        />
        <Stat
          label="Earnings (net)"
          value={money(earnings)}
          testId="tasker-earnings"
          hint={`${completed.length} completed · after commission`}
        />
        <Stat label="Tips" value={money(tips)} testId="tasker-tips" hint="100% yours" />
        <Stat
          label="Strikes"
          value={`${recentStrikes} / ${active?.taskerPenalty.strikesToSuspend ?? 3}`}
          testId="tasker-strikes"
          hint={`in the last ${windowDays} days`}
        />
      </div>

      {bookings.loading ? (
        <Spinner />
      ) : (
        <div className="space-y-8">
          <section>
            <H2>Requests</H2>
            {!requests.length ? (
              <Empty>No new requests.</Empty>
            ) : (
              <div className="space-y-3">
                {requests.map((x) => (
                  <JobCard key={x.booking.id} x={x}>
                    <Button
                      data-testid="accept"
                      disabled={accept.pending || t?.status !== "active"}
                      onClick={async () => {
                        if (await accept.run(x.booking.id)) done("Booking accepted.");
                      }}
                    >
                      Accept
                    </Button>
                    <Button
                      variant="danger"
                      data-testid="decline"
                      disabled={decline.pending}
                      onClick={async () => {
                        if (await decline.run(x.booking.id))
                          done("Booking declined. The client's card hold was released.");
                      }}
                    >
                      Decline
                    </Button>
                  </JobCard>
                ))}
              </div>
            )}
          </section>
          <section>
            <H2>Upcoming & in progress</H2>
            {!upcoming.length ? (
              <Empty>Nothing scheduled.</Empty>
            ) : (
              <div className="space-y-3">
                {upcoming.map((x) => (
                  <JobCard key={x.booking.id} x={x}>
                    {x.booking.status === "accepted" && (
                      <>
                        <Button
                          data-testid="start"
                          disabled={start.pending}
                          onClick={async () => {
                            if (await start.run(x.booking.id)) done("Task started.");
                          }}
                        >
                          Start task
                        </Button>
                        <Button
                          variant="secondary"
                          data-testid="reschedule-open"
                          onClick={() => setDialog({ kind: "reschedule", x })}
                        >
                          Reschedule
                        </Button>
                        <Button
                          variant="danger"
                          data-testid="tasker-cancel-open"
                          onClick={() => setDialog({ kind: "cancel", x })}
                        >
                          Cancel
                        </Button>
                      </>
                    )}
                    {x.booking.status === "in_progress" && (
                      <Button
                        data-testid="complete-open"
                        onClick={() => setDialog({ kind: "complete", x })}
                      >
                        Complete task
                      </Button>
                    )}
                  </JobCard>
                ))}
              </div>
            )}
          </section>
          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <H2>History</H2>
              {!history.length ? (
                <Empty>No past jobs.</Empty>
              ) : (
                <table data-testid="tasker-history">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Client</th>
                      <th>Status</th>
                      <th className="text-right">Subtotal</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.map((x) => (
                      <tr key={x.booking.id}>
                        <td>{fmtDate(x.booking.start_at)}</td>
                        <td>{x.clientName}</td>
                        <td>
                          <Badge value={x.booking.status} />
                        </td>
                        <td className="text-right tabular-nums">
                          {money(x.booking.subtotal_cents)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>
            <div className="space-y-6">
              <Card>
                <H2>Payouts</H2>
                <p className="mb-2 text-xs text-slate-500">
                  Paid out so far: <strong>{money(paidOut)}</strong>. Earnings are held{" "}
                  {active?.payouts.holdDays ?? 3} days after completion.
                </p>
                {!payouts.data?.length ? (
                  <Empty>No payouts yet.</Empty>
                ) : (
                  <table data-testid="tasker-payouts">
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Jobs</th>
                        <th>Status</th>
                        <th className="text-right">Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {payouts.data.map((p) => (
                        <tr key={p.id}>
                          <td>{fmtDate(p.created_at)}</td>
                          <td>{p.booking_ids.length}</td>
                          <td>
                            <Badge value={p.status} />
                          </td>
                          <td className="text-right tabular-nums">{money(p.amount_cents)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </Card>
              <Card>
                <H2>Strikes</H2>
                <p className="mb-2 text-xs text-slate-500">
                  {active
                    ? `${active.taskerPenalty.strikesToSuspend} strikes within ${windowDays} days suspends your account. Each tasker cancellation costs ${money(active.taskerPenalty.cancelFeeCents)}.`
                    : null}
                </p>
                {!strikes.data?.length ? (
                  <Empty>No strikes. Nice work.</Empty>
                ) : (
                  <table data-testid="tasker-strikes-table">
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Reason</th>
                        <th className="text-right">Fee</th>
                      </tr>
                    </thead>
                    <tbody>
                      {strikes.data.map((s) => (
                        <tr key={s.id}>
                          <td>{fmtDate(s.created_at)}</td>
                          <td>{s.reason}</td>
                          <td className="text-right tabular-nums">{money(s.fee_cents)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </Card>
            </div>
          </div>
        </div>
      )}
      {dialog?.kind === "complete" && policies.policyFor(dialog.x.booking.policy_version) && (
        <CompleteDialog
          x={dialog.x}
          policy={policies.policyFor(dialog.x.booking.policy_version)!}
          onClose={() => setDialog(null)}
          onDone={done}
        />
      )}
      {dialog?.kind === "cancel" && policies.policyFor(dialog.x.booking.policy_version) && (
        <TaskerCancelDialog
          x={dialog.x}
          policy={policies.policyFor(dialog.x.booking.policy_version)!}
          strikes={recentStrikes}
          onClose={() => setDialog(null)}
          onDone={done}
        />
      )}
      {dialog?.kind === "reschedule" && (
        <RescheduleDialog x={dialog.x} onClose={() => setDialog(null)} onDone={done} />
      )}
    </div>
  );
}

function JobCard({ x, children }: { x: BookingBundle; children: React.ReactNode }) {
  const b = x.booking;
  return (
    <Card data-testid="job-card" data-booking-id={b.id} data-status={b.status}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="font-semibold text-slate-900">{x.clientName}</span>
            <Badge value={b.status} testId="job-status" />
          </div>
          <div className="mt-1 text-sm text-slate-600">
            {fmtDateTime(b.start_at, b.location_tz)} · {fmtMinutes(b.est_minutes)}
          </div>
          {b.description && <div className="mt-1 text-sm text-slate-500">{b.description}</div>}
          <TenderBreakdown b={x} />
        </div>
        <div className="text-right">
          <div className="text-lg font-semibold tabular-nums">{money(b.subtotal_cents)}</div>
          <div className="text-xs text-slate-500">task subtotal</div>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">{children}</div>
    </Card>
  );
}

function CompleteDialog({
  x,
  policy,
  onClose,
  onDone,
}: {
  x: BookingBundle;
  policy: MoneyPolicy;
  onClose: () => void;
  onDone: (m: string) => void;
}) {
  const b = x.booking;
  const [extraMinutes, setExtraMinutes] = useState("0");
  const [expenses, setExpenses] = useState("");
  const extraMin = Math.max(0, Math.floor(Number(extraMinutes) || 0));
  const expCents = expenses ? parseDollars(expenses) : 0;
  const extraLabor = extraMin > 0 ? laborCents(Number(b.rate_cents), extraMin) : 0;
  const extraFee = applyBps(extraLabor, policy.clientServiceFeeBps);
  const commission = applyBps(Number(b.subtotal_cents) + extraLabor, policy.taskerCommissionBps);
  const act = useAction((key: string) =>
    api.complete(
      b.id,
      { extraMinutes: extraMin || undefined, expensesCents: expCents || undefined },
      key,
    ),
  );
  return (
    <Modal title="Complete task" onClose={onClose} testId="complete-dialog">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Extra minutes" id="xm">
          <Input
            id="xm"
            data-testid="complete-extra-minutes"
            inputMode="numeric"
            value={extraMinutes}
            onChange={(e) => setExtraMinutes(e.target.value.replace(/[^0-9]/g, ""))}
          />
        </Field>
        <Field label="Expenses ($)" id="xe" hint="Materials you paid for">
          <Input
            id="xe"
            data-testid="complete-expenses"
            inputMode="decimal"
            value={expenses}
            onChange={(e) => setExpenses(e.target.value)}
          />
        </Field>
      </div>
      {expCents === null && (
        <p className="mb-2 text-sm text-red-600">Enter expenses as dollars, e.g. 12.50</p>
      )}
      <div className="mb-3 rounded-lg bg-slate-50 p-3" data-testid="complete-preview">
        <MoneyRow
          label={`Booked (${fmtMinutes(b.est_minutes)})`}
          cents={Number(b.subtotal_cents)}
        />
        <MoneyRow
          label={`Extra time (${extraMin} min)`}
          cents={extraLabor}
          testId="complete-extra-labor"
        />
        <MoneyRow label="Expenses" cents={expCents ?? 0} testId="complete-expense-amount" />
        <MoneyRow label="Commission (est.)" cents={commission} negative />
        <MoneyRow
          label="Your earnings (est.)"
          cents={Number(b.subtotal_cents) + extraLabor - commission + (expCents ?? 0)}
          strong
          testId="complete-earnings"
        />
        {(extraLabor > 0 || (expCents ?? 0) > 0) && (
          <p className="mt-2 text-xs text-slate-500">
            Extras are charged to the client's card as a separate charge
            {extraFee ? ` (plus ${money(extraFee)} service fee)` : ""}. The final amount is set by
            the server.
          </p>
        )}
      </div>
      {act.error && (
        <Banner tone="error" testId="complete-error">
          {act.error}
        </Banner>
      )}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          Close
        </Button>
        <Button
          data-testid="complete-confirm"
          disabled={act.pending || expCents === null}
          onClick={async () => {
            if (await act.run()) onDone("Task completed. The client's card was charged.");
          }}
        >
          Mark complete
        </Button>
      </div>
    </Modal>
  );
}

function TaskerCancelDialog({
  x,
  policy,
  strikes,
  onClose,
  onDone,
}: {
  x: BookingBundle;
  policy: MoneyPolicy;
  strikes: number;
  onClose: () => void;
  onDone: (m: string) => void;
}) {
  const [reason, setReason] = useState("");
  const p = previewTaskerCancel(x.booking, x.tenders, policy);
  const act = useAction((key: string) => api.cancel(x.booking.id, reason.trim(), key));
  const willSuspend = strikes + 1 >= policy.taskerPenalty.strikesToSuspend;
  return (
    <Modal title="Cancel this job?" onClose={onClose} testId="tasker-cancel-dialog">
      <Banner tone={willSuspend ? "error" : "warning"}>
        The client gets a full refund. You get a strike and a {money(p.taskerFeeCents ?? 0)} fee.
        {willSuspend &&
          ` This would be strike ${strikes + 1} of ${policy.taskerPenalty.strikesToSuspend} and suspend your account.`}
      </Banner>
      <div className="mb-3 rounded-lg bg-slate-50 p-3">
        {(["card", "points", "wallet", "promo"] as const)
          .filter((t) => p.refund[t] > 0)
          .map((t) => (
            <MoneyRow key={t} label={`Client refund to ${TENDER_LABEL[t]}`} cents={p.refund[t]} />
          ))}
        <MoneyRow label="Client refund" cents={p.outcome.refundCents} strong />
      </div>
      <Field label="Reason (required)" id="tcr">
        <Input
          id="tcr"
          data-testid="tasker-cancel-reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </Field>
      {act.error && <Banner tone="error">{act.error}</Banner>}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          Keep job
        </Button>
        <Button
          variant="danger"
          data-testid="tasker-cancel-confirm"
          disabled={act.pending || !reason.trim()}
          onClick={async () => {
            if (await act.run()) onDone("Job canceled. The client was refunded in full.");
          }}
        >
          Cancel job
        </Button>
      </div>
    </Modal>
  );
}
