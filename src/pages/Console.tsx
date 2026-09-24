import { useMemo, useState } from "react";
import type { Actor, RefundKind } from "@domain";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import {
  disputesFor,
  ledger,
  listTaskers,
  searchBookings,
  taskerPayouts,
  type BookingBundle,
} from "../lib/data";
import { fmtDateTime, fmtMinutes, money, parseDollars } from "../lib/format";
import { usePolicies } from "../lib/policy";
import { previewRefund, TENDER_LABEL } from "../lib/preview";
import { supabase, type Profile } from "../lib/supabase";
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
  MoneyRow,
  Select,
  Spinner,
  Textarea,
  useAction,
  useLoad,
} from "../components/ui";
import { TenderBreakdown } from "./MyBookings";

type Tab = "bookings" | "taskers" | "payouts" | "ledger";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATUSES = [
  "requested",
  "accepted",
  "in_progress",
  "completed",
  "canceled_client",
  "canceled_tasker",
  "declined",
  "no_show_client",
  "no_show_tasker",
  "disputed",
];

export default function Console() {
  const { profile } = useAuth();
  const isAdmin = profile?.role === "admin";
  const [tab, setTab] = useState<Tab>("bookings");
  const [ledgerBooking, setLedgerBooking] = useState("");
  const tabs: [Tab, string][] = [
    ["bookings", "Bookings & refunds"],
    ["taskers", "Taskers"],
    ...(isAdmin ? [["payouts", "Payouts"] as [Tab, string]] : []),
    ["ledger", "Ledger"],
  ];
  return (
    <div>
      <H1
        sub={
          isAdmin
            ? "Admin: full access."
            : `Support agent: refunds above the agent limit need an admin approver.`
        }
      >
        {isAdmin ? "Admin console" : "Support console"}
      </H1>
      <div className="mb-6 flex gap-1 border-b border-slate-200">
        {tabs.map(([k, label]) => (
          <button
            key={k}
            data-testid={`tab-${k}`}
            onClick={() => setTab(k)}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium ${tab === k ? "border-blue-600 text-blue-700" : "border-transparent text-slate-500 hover:text-slate-800"}`}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === "bookings" && (
        <BookingsTab
          isAdmin={isAdmin}
          actor={(profile?.role ?? "support_agent") as Actor}
          onLedger={(id) => {
            setLedgerBooking(id);
            setTab("ledger");
          }}
        />
      )}
      {tab === "taskers" && <TaskersTab isAdmin={isAdmin} />}
      {tab === "payouts" && isAdmin && <PayoutsTab />}
      {tab === "ledger" && <LedgerTab initialBooking={ledgerBooking} />}
    </div>
  );
}

function BookingsTab({
  isAdmin,
  actor,
  onLedger,
}: {
  isAdmin: boolean;
  actor: Actor;
  onLedger: (id: string) => void;
}) {
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");
  const [submitted, setSubmitted] = useState("");
  const { data, error, loading, reload } = useLoad(
    () =>
      searchBookings({
        status: status || undefined,
        id: UUID.test(submitted) ? submitted : undefined,
        limit: 100,
      }),
    [status, submitted],
  );
  const [selected, setSelected] = useState<string | null>(null);
  const rows = (data ?? []).filter(
    (x) =>
      UUID.test(submitted) ||
      !submitted ||
      `${x.booking.id} ${x.clientName} ${x.taskerName} ${x.booking.description}`
        .toLowerCase()
        .includes(submitted.toLowerCase()),
  );
  const sel = rows.find((x) => x.booking.id === selected) ?? null;
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_26rem]">
      <div>
        <form
          className="mb-4 flex flex-wrap gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setSubmitted(q.trim());
          }}
        >
          <Input
            data-testid="console-search"
            placeholder="Booking ID, client, tasker or description"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="max-w-sm"
          />
          <Select
            data-testid="console-status"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="max-w-[12rem]"
          >
            <option value="">Any status</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s.replace(/_/g, " ")}
              </option>
            ))}
          </Select>
          <Button type="submit" data-testid="console-search-submit">
            Search
          </Button>
        </form>
        {error && <Banner tone="error">{error}</Banner>}
        {loading ? (
          <Spinner />
        ) : !rows.length ? (
          <Empty>No bookings found.</Empty>
        ) : (
          <Card className="!p-0 overflow-x-auto">
            <table data-testid="console-bookings">
              <thead>
                <tr>
                  <th>Start</th>
                  <th>Client</th>
                  <th>Tasker</th>
                  <th>Status</th>
                  <th className="text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((x) => (
                  <tr
                    key={x.booking.id}
                    data-testid="console-booking-row"
                    data-booking-id={x.booking.id}
                    onClick={() => setSelected(x.booking.id)}
                    className={`cursor-pointer hover:bg-blue-50 ${selected === x.booking.id ? "bg-blue-50" : ""}`}
                  >
                    <td className="whitespace-nowrap">
                      {fmtDateTime(x.booking.start_at, x.booking.location_tz)}
                    </td>
                    <td>{x.clientName}</td>
                    <td>{x.taskerName}</td>
                    <td>
                      <Badge value={x.booking.status} />
                    </td>
                    <td className="text-right tabular-nums">{money(x.booking.total_cents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}
      </div>
      <div>
        {sel ? (
          <BookingDetail
            key={sel.booking.id}
            x={sel}
            isAdmin={isAdmin}
            actor={actor}
            onChanged={reload}
            onLedger={onLedger}
          />
        ) : (
          <Empty>Select a booking to see details and issue refunds.</Empty>
        )}
      </div>
    </div>
  );
}

function BookingDetail({
  x,
  isAdmin,
  actor,
  onChanged,
  onLedger,
}: {
  x: BookingBundle;
  isAdmin: boolean;
  actor: Actor;
  onChanged: () => void;
  onLedger: (id: string) => void;
}) {
  const b = x.booking;
  const policies = usePolicies();
  const policy = policies.policyFor(b.policy_version);
  const disputes = useLoad(() => disputesFor([b.id]), [b.id]);
  const admins = useLoad(async () => {
    const r = await supabase.from("profiles").select("id, full_name, role").eq("role", "admin");
    return (r.data ?? []) as Pick<Profile, "id" | "full_name" | "role">[];
  }, []);
  const [kind, setKind] = useState<RefundKind>("partial");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [approvedBy, setApprovedBy] = useState("");
  const [flash, setFlash] = useState<string | null>(null);
  const disputeOpen = (disputes.data ?? []).some(
    (d) => d.status === "needs_response" || d.status === "under_review",
  );
  const cents = kind === "full" ? 0 : (parseDollars(amount) ?? 0);
  const pv = policy
    ? previewRefund(
        kind,
        cents,
        actor,
        reason || "-",
        approvedBy || undefined,
        b,
        x.tenders,
        policy,
        disputeOpen,
        new Date(),
      )
    : null;
  const amt = kind === "full" ? (pv?.refundable ?? 0) : cents;
  const overLimit = !!policy && actor === "support_agent" && amt > policy.refunds.agentLimitCents;
  const refund = useAction((key: string) =>
    api.refund(
      b.id,
      { kind, amountCents: amt, reason: reason.trim(), approvedBy: approvedBy || undefined },
      key,
    ),
  );
  const dispute = useAction((key: string, outcome: "won" | "lost") =>
    api.simulateDispute(b.id, outcome, key),
  );

  return (
    <Card data-testid="console-booking-detail">
      <div className="mb-2 flex items-center justify-between">
        <H2>Booking</H2>
        <Badge value={b.status} />
      </div>
      <div className="mb-3 space-y-0.5 text-xs text-slate-500">
        <div className="font-mono">{b.id}</div>
        <div>
          {x.clientName} → {x.taskerName} · {fmtMinutes(b.est_minutes)} · policy v{b.policy_version}
        </div>
      </div>
      <MoneyRow label="Subtotal" cents={Number(b.subtotal_cents)} />
      <MoneyRow label="Service fee" cents={Number(b.service_fee_cents)} />
      <MoneyRow label="Tax" cents={Number(b.tax_cents)} />
      <MoneyRow label="Total" cents={Number(b.total_cents)} strong />
      {Number(b.extra_cents) > 0 && (
        <MoneyRow label="Extras (separate charge)" cents={Number(b.extra_cents)} />
      )}
      <TenderBreakdown b={x} />
      {!!x.refunds.length && (
        <div className="mt-3 text-xs">
          <div className="font-semibold uppercase text-slate-500">Refunds</div>
          {x.refunds.map((r) => (
            <div key={r.id} className="flex justify-between">
              <span>
                {r.kind} · {r.actor_role} · {r.reason}
              </span>
              <span className="tabular-nums">{money(r.amount_cents)}</span>
            </div>
          ))}
        </div>
      )}
      {!!disputes.data?.length && (
        <div className="mt-2 text-xs text-red-700">
          Dispute: {disputes.data.map((d) => `${d.status} ${money(d.amount_cents)}`).join(", ")}
        </div>
      )}
      <Button
        variant="ghost"
        className="mt-2 !px-0 text-blue-700"
        data-testid="view-ledger"
        onClick={() => onLedger(b.id)}
      >
        View ledger entries →
      </Button>

      <hr className="my-4 border-slate-200" />
      <H2>Refund</H2>
      {flash && (
        <Banner tone="success" testId="refund-flash">
          {flash}
        </Banner>
      )}
      <div className="grid grid-cols-2 gap-3">
        <Field label="Type" id="ck">
          <Select
            id="ck"
            data-testid="console-refund-kind"
            value={kind}
            onChange={(e) => setKind(e.target.value as RefundKind)}
          >
            <option value="partial">Partial</option>
            <option value="full">Full</option>
            <option value="goodwill">Goodwill (platform-funded)</option>
          </Select>
        </Field>
        <Field label="Amount ($)" id="ca">
          <Input
            id="ca"
            data-testid="console-refund-amount"
            inputMode="decimal"
            disabled={kind === "full"}
            value={kind === "full" ? ((pv?.refundable ?? 0) / 100).toFixed(2) : amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </Field>
      </div>
      <Field label="Reason (required)" id="cr">
        <Textarea
          id="cr"
          data-testid="console-refund-reason"
          rows={2}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </Field>
      {(overLimit || actor === "support_agent") && (
        <Field
          label="Approved by (admin)"
          id="cap"
          hint={
            policy
              ? `Required for agent refunds above ${money(policy.refunds.agentLimitCents)}.`
              : undefined
          }
        >
          <Select
            id="cap"
            data-testid="console-refund-approver"
            value={approvedBy}
            onChange={(e) => setApprovedBy(e.target.value)}
          >
            <option value="">— none —</option>
            {(admins.data ?? []).map((a) => (
              <option key={a.id} value={a.id}>
                {a.full_name || a.id}
              </option>
            ))}
          </Select>
        </Field>
      )}
      {pv?.plan && amt > 0 && (
        <div
          className="mb-3 rounded-lg bg-slate-50 p-3 text-sm"
          data-testid="console-refund-preview"
        >
          {(["card", "wallet", "points", "promo"] as const)
            .filter((t) => pv.plan!.perTender[t] > 0)
            .map((t) => (
              <MoneyRow key={t} label={`To ${TENDER_LABEL[t]}`} cents={pv.plan!.perTender[t]} />
            ))}
          <MoneyRow label="Tasker clawback" cents={pv.plan.taskerClawbackCents} />
          <MoneyRow label="Platform cost" cents={pv.plan.platformCostCents} />
          <MoneyRow label="Refund total" cents={amt} strong />
        </div>
      )}
      {pv?.error && amt > 0 && pv.error !== "refund reason is required" && (
        <p className="mb-2 text-sm text-red-600" data-testid="console-refund-error">
          {pv.error}
        </p>
      )}
      {refund.error && <Banner tone="error">{refund.error}</Banner>}
      <Button
        data-testid="console-refund-submit"
        disabled={refund.pending || !reason.trim() || amt <= 0 || !pv?.plan}
        onClick={async () => {
          if (await refund.run()) {
            setFlash(`Refunded ${money(amt)}.`);
            setReason("");
            setAmount("");
            onChanged();
          }
        }}
      >
        Issue refund {amt > 0 ? money(amt) : ""}
      </Button>

      {isAdmin && (
        <>
          <hr className="my-4 border-slate-200" />
          <H2>Simulate dispute</H2>
          <p className="mb-2 text-xs text-slate-500">Test hook (fake payments provider only).</p>
          {dispute.error && <Banner tone="error">{dispute.error}</Banner>}
          <div className="flex gap-2">
            <Button
              variant="secondary"
              data-testid="dispute-won"
              disabled={dispute.pending}
              onClick={async () => {
                if (await dispute.run("won")) {
                  setFlash("Dispute simulated: won.");
                  onChanged();
                  disputes.reload();
                }
              }}
            >
              Dispute → won
            </Button>
            <Button
              variant="danger"
              data-testid="dispute-lost"
              disabled={dispute.pending}
              onClick={async () => {
                if (await dispute.run("lost")) {
                  setFlash("Dispute simulated: lost.");
                  onChanged();
                  disputes.reload();
                }
              }}
            >
              Dispute → lost
            </Button>
          </div>
        </>
      )}
    </Card>
  );
}

function TaskersTab({ isAdmin }: { isAdmin: boolean }) {
  const { data, error, loading, reload } = useLoad(() => listTaskers({ includeAll: true }), []);
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [flash, setFlash] = useState<string | null>(null);
  const act = useAction((key: string, id: string, status: "active" | "suspended", reason: string) =>
    api.setTaskerStatus(id, status, reason, key),
  );
  return (
    <div>
      {flash && <Banner tone="success">{flash}</Banner>}
      {(error || act.error) && <Banner tone="error">{error ?? act.error}</Banner>}
      {!isAdmin && <Banner tone="info">Only admins can suspend or activate taskers.</Banner>}
      {loading ? (
        <Spinner />
      ) : (
        <Card className="!p-0 overflow-x-auto">
          <table data-testid="console-taskers">
            <thead>
              <tr>
                <th>Tasker</th>
                <th>Category</th>
                <th>Rate</th>
                <th>Status</th>
                {isAdmin && <th>Action</th>}
              </tr>
            </thead>
            <tbody>
              {(data ?? []).map((t) => (
                <tr key={t.id} data-testid="console-tasker-row" data-tasker-id={t.id}>
                  <td>{t.name}</td>
                  <td>{t.category}</td>
                  <td>{money(t.hourly_rate_cents)}/h</td>
                  <td>
                    <Badge value={t.status} />
                  </td>
                  {isAdmin && (
                    <td>
                      <div className="flex gap-2">
                        <Input
                          data-testid="tasker-status-reason"
                          placeholder="Reason (required)"
                          value={reasons[t.id] ?? ""}
                          onChange={(e) => setReasons({ ...reasons, [t.id]: e.target.value })}
                          className="min-w-[10rem]"
                        />
                        {t.status === "active" ? (
                          <Button
                            variant="danger"
                            data-testid="tasker-suspend"
                            disabled={act.pending || !reasons[t.id]?.trim()}
                            onClick={async () => {
                              if (await act.run(t.id, "suspended", reasons[t.id].trim())) {
                                setFlash(`${t.name} suspended.`);
                                reload();
                              }
                            }}
                          >
                            Suspend
                          </Button>
                        ) : (
                          <Button
                            data-testid="tasker-activate"
                            disabled={act.pending || !reasons[t.id]?.trim()}
                            onClick={async () => {
                              if (await act.run(t.id, "active", reasons[t.id].trim())) {
                                setFlash(`${t.name} activated.`);
                                reload();
                              }
                            }}
                          >
                            Activate
                          </Button>
                        )}
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}

function PayoutsTab() {
  const { data, error, loading, reload } = useLoad(() => taskerPayouts(), []);
  const [result, setResult] = useState<unknown>(null);
  const run = useAction((key: string) => api.runPayouts(key));
  return (
    <div className="space-y-4">
      <Card>
        <H2>Payout run</H2>
        <p className="mb-3 text-sm text-slate-500">
          Pays each active tasker their settled earnings past the hold period, net of clawbacks and
          fees.
        </p>
        {run.error && <Banner tone="error">{run.error}</Banner>}
        <Button
          data-testid="payout-run"
          disabled={run.pending}
          onClick={async () => {
            const r = await run.run();
            if (r) {
              setResult(r);
              reload();
            }
          }}
        >
          {run.pending ? "Running…" : "Run payouts now"}
        </Button>
        {result !== null && (
          <pre
            data-testid="payout-result"
            className="mt-3 max-h-64 overflow-auto rounded-lg bg-slate-50 p-3 text-xs"
          >
            {JSON.stringify(result, null, 2)}
          </pre>
        )}
      </Card>
      {error && <Banner tone="error">{error}</Banner>}
      {loading ? (
        <Spinner />
      ) : !data?.length ? (
        <Empty>No payouts yet.</Empty>
      ) : (
        <Card className="!p-0">
          <table data-testid="console-payouts">
            <thead>
              <tr>
                <th>Date</th>
                <th>Tasker</th>
                <th>Jobs</th>
                <th>Status</th>
                <th className="text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {data.map((p) => (
                <tr key={p.id}>
                  <td>{fmtDateTime(p.created_at)}</td>
                  <td className="font-mono text-xs">{p.tasker_id.slice(0, 8)}</td>
                  <td>{p.booking_ids.length}</td>
                  <td>
                    <Badge value={p.status} />
                  </td>
                  <td className="text-right tabular-nums">{money(p.amount_cents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}

function LedgerTab({ initialBooking }: { initialBooking: string }) {
  const [input, setInput] = useState(initialBooking);
  const [bookingId, setBookingId] = useState(initialBooking);
  const { data, error, loading } = useLoad(
    () => ledger({ bookingId: bookingId || undefined, limit: 100 }),
    [bookingId],
  );
  const totals = useMemo(() => {
    const t: Record<string, { debit: number; credit: number }> = {};
    for (const x of data ?? [])
      for (const l of x.lines) {
        t[l.unit] ??= { debit: 0, credit: 0 };
        t[l.unit].debit += Number(l.debit);
        t[l.unit].credit += Number(l.credit);
      }
    return t;
  }, [data]);
  const fmt = (unit: string, v: number) =>
    v === 0 ? "" : unit === "USD" ? money(v) : `${v.toLocaleString()} pts`;
  return (
    <div>
      <form
        className="mb-4 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setBookingId(input.trim());
        }}
      >
        <Input
          data-testid="ledger-booking"
          placeholder="Filter by booking ID (blank = latest 100 txns)"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          className="max-w-md"
        />
        <Button type="submit">Show</Button>
      </form>
      {error && <Banner tone="error">{error}</Banner>}
      <div className="mb-3 flex gap-4 text-xs text-slate-500" data-testid="ledger-totals">
        {Object.entries(totals).map(([u, v]) => (
          <span key={u}>
            {u}: debits {fmt(u, v.debit) || 0} · credits {fmt(u, v.credit) || 0}{" "}
            {v.debit === v.credit ? (
              <span className="text-emerald-700">balanced</span>
            ) : (
              <span className="text-red-600">UNBALANCED</span>
            )}
          </span>
        ))}
      </div>
      {loading ? (
        <Spinner />
      ) : !data?.length ? (
        <Empty>No ledger transactions.</Empty>
      ) : (
        <div className="space-y-3" data-testid="ledger-txns">
          {data.map((t) => {
            const bal = ["USD", "POINTS"].every(
              (u) =>
                t.lines
                  .filter((l) => l.unit === u)
                  .reduce((a, l) => a + Number(l.debit) - Number(l.credit), 0) === 0,
            );
            return (
              <Card key={t.id} className="!p-0" data-testid="ledger-txn">
                <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2 text-sm">
                  <span>
                    <strong>{t.kind}</strong>{" "}
                    <span className="text-xs text-slate-400">
                      {fmtDateTime(t.created_at)}
                      {t.booking_id && ` · booking ${t.booking_id.slice(0, 8)}`}
                    </span>
                  </span>
                  <span className={`text-xs ${bal ? "text-emerald-700" : "text-red-600"}`}>
                    {bal ? "balanced" : "unbalanced"}
                  </span>
                </div>
                <table>
                  <thead>
                    <tr>
                      <th>Account</th>
                      <th>Party</th>
                      <th className="text-right">Debit</th>
                      <th className="text-right">Credit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {t.lines.map((l) => (
                      <tr key={l.id}>
                        <td className="font-mono text-xs">{l.account}</td>
                        <td className="font-mono text-xs text-slate-400">
                          {l.party?.slice(0, 8) ?? ""}
                        </td>
                        <td className="text-right tabular-nums">{fmt(l.unit, Number(l.debit))}</td>
                        <td className="text-right tabular-nums">{fmt(l.unit, Number(l.credit))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
