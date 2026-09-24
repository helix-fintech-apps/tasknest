import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { type MoneyPolicy, type RefundKind } from "@domain";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { myBookings, type BookingBundle } from "../lib/data";
import { fmtDateTime, fmtMinutes, money, parseDollars } from "../lib/format";
import { usePolicies } from "../lib/policy";
import {
  paidParts,
  previewClientCancel,
  previewRefund,
  TENDER_LABEL,
  tipCap,
  tipProblem,
} from "../lib/preview";
import {
  Badge,
  Banner,
  Button,
  Card,
  Empty,
  Field,
  H1,
  Input,
  Modal,
  MoneyRow,
  Select,
  Spinner,
  Textarea,
  useAction,
  useLoad,
} from "../components/ui";

type Dialog = {
  kind: "cancel" | "reschedule" | "tip" | "review" | "refund";
  b: BookingBundle;
} | null;

export function useNow(intervalMs = 30_000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

export function TenderBreakdown({ b }: { b: BookingBundle }) {
  if (!b.tenders.length) return null;
  return (
    <div className="text-xs text-slate-500" data-testid="booking-tenders">
      {b.tenders
        .filter((t) => Number(t.amount_cents) > 0)
        .map((t) => (
          <span key={t.tender} className="mr-3">
            {TENDER_LABEL[t.tender]} {money(t.amount_cents)}
            {t.tender === "points" && t.points ? ` (${t.points} pts)` : ""}
            {Number(t.refunded_cents) > 0 && (
              <span className="text-emerald-700"> · refunded {money(t.refunded_cents)}</span>
            )}
          </span>
        ))}
    </div>
  );
}

export default function MyBookings() {
  const { profile } = useAuth();
  const loc = useLocation();
  const [flash, setFlash] = useState<string | null>(
    (loc.state as { flash?: string } | null)?.flash ?? null,
  );
  const { data, error, loading, reload } = useLoad(
    () => myBookings(profile!.id, "client"),
    [profile?.id],
  );
  const policies = usePolicies();
  const [dialog, setDialog] = useState<Dialog>(null);

  const done = (msg: string) => {
    setDialog(null);
    setFlash(msg);
    reload();
  };
  const upcoming = (data ?? []).filter((x) =>
    ["requested", "accepted", "in_progress"].includes(x.booking.status),
  );
  const past = (data ?? []).filter(
    (x) => !["requested", "accepted", "in_progress"].includes(x.booking.status),
  );

  const policyOf = (b: BookingBundle) => policies.policyFor(b.booking.policy_version);

  return (
    <div>
      <H1 sub="Cancel, reschedule, tip, review or request a refund.">My bookings</H1>
      {flash && (
        <Banner tone="success" testId="flash">
          {flash}
        </Banner>
      )}
      {(error || policies.error) && <Banner tone="error">{error ?? policies.error}</Banner>}
      {loading ? (
        <Spinner />
      ) : !data?.length ? (
        <Empty>No bookings yet. Find a tasker to get started.</Empty>
      ) : (
        <div className="space-y-8">
          {[
            ["Upcoming", upcoming],
            ["Past", past],
          ].map(
            ([title, list]) =>
              (list as BookingBundle[]).length > 0 && (
                <section key={title as string}>
                  <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
                    {title as string}
                  </h2>
                  <div className="space-y-3">
                    {(list as BookingBundle[]).map((x) => (
                      <BookingCard
                        key={x.booking.id}
                        x={x}
                        policy={policyOf(x)}
                        onAction={(kind) => setDialog({ kind, b: x })}
                      />
                    ))}
                  </div>
                </section>
              ),
          )}
        </div>
      )}
      {dialog && policyOf(dialog.b) && (
        <>
          {dialog.kind === "cancel" && (
            <CancelDialog
              x={dialog.b}
              policy={policyOf(dialog.b)!}
              onClose={() => setDialog(null)}
              onDone={done}
            />
          )}
          {dialog.kind === "reschedule" && (
            <RescheduleDialog x={dialog.b} onClose={() => setDialog(null)} onDone={done} />
          )}
          {dialog.kind === "tip" && (
            <TipDialog
              x={dialog.b}
              policy={policyOf(dialog.b)!}
              onClose={() => setDialog(null)}
              onDone={done}
            />
          )}
          {dialog.kind === "review" && (
            <ReviewDialog
              x={dialog.b}
              policy={policyOf(dialog.b)!}
              onClose={() => setDialog(null)}
              onDone={done}
            />
          )}
          {dialog.kind === "refund" && (
            <RefundRequestDialog
              x={dialog.b}
              policy={policyOf(dialog.b)!}
              onClose={() => setDialog(null)}
              onDone={done}
            />
          )}
        </>
      )}
    </div>
  );
}

function BookingCard({
  x,
  policy,
  onAction,
}: {
  x: BookingBundle;
  policy: MoneyPolicy | null;
  onAction: (k: NonNullable<Dialog>["kind"]) => void;
}) {
  const b = x.booking;
  const tipped = x.tips.reduce((a, t) => a + Number(t.amount_cents), 0);
  const refunded = x.refunds.reduce((a, r) => a + Number(r.amount_cents), 0);
  const cancellable = ["requested", "accepted"].includes(b.status);
  const completed = b.status === "completed";
  return (
    <Card data-testid="booking-card" data-booking-id={b.id} data-status={b.status}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="font-semibold text-slate-900">{x.taskerName}</span>
            <Badge value={b.status} testId="booking-status" />
          </div>
          <div className="mt-1 text-sm text-slate-600">
            {fmtDateTime(b.start_at, b.location_tz)} · {fmtMinutes(b.est_minutes)}
          </div>
          {b.original_start_at !== b.start_at && (
            <div className="text-xs text-slate-400">
              Originally {fmtDateTime(b.original_start_at, b.location_tz)}
            </div>
          )}
          {b.description && <div className="mt-1 text-sm text-slate-500">{b.description}</div>}
          <TenderBreakdown b={x} />
        </div>
        <div className="text-right">
          <div
            className="text-lg font-semibold tabular-nums text-slate-900"
            data-testid="booking-total"
          >
            {money(b.total_cents)}
          </div>
          {Number(b.extra_cents) > 0 && (
            <div className="text-xs text-slate-500">+ {money(b.extra_cents)} extras</div>
          )}
          {tipped > 0 && <div className="text-xs text-slate-500">+ {money(tipped)} tip</div>}
          {refunded > 0 && (
            <div className="text-xs text-emerald-700">{money(refunded)} refunded</div>
          )}
          {b.points_earned > 0 && (
            <div className="text-xs text-blue-700">+{b.points_earned} pts earned</div>
          )}
        </div>
      </div>
      {!policy && (
        <p className="mt-2 text-xs text-amber-700">
          Policy v{b.policy_version} not loaded — actions disabled.
        </p>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        {cancellable && (
          <Button
            variant="danger"
            data-testid="cancel-open"
            disabled={!policy}
            onClick={() => onAction("cancel")}
          >
            Cancel
          </Button>
        )}
        {cancellable && (
          <Button
            variant="secondary"
            data-testid="reschedule-open"
            onClick={() => onAction("reschedule")}
          >
            Reschedule
          </Button>
        )}
        {completed && (
          <Button
            variant="secondary"
            data-testid="tip-open"
            disabled={!policy}
            onClick={() => onAction("tip")}
          >
            Add a tip
          </Button>
        )}
        {completed && !x.review && (
          <Button variant="secondary" data-testid="review-open" onClick={() => onAction("review")}>
            Leave a review
          </Button>
        )}
        {(completed || b.status === "no_show_client") && (
          <Button
            variant="ghost"
            data-testid="refund-open"
            disabled={!policy}
            onClick={() => onAction("refund")}
          >
            Request a refund
          </Button>
        )}
        {x.review && (
          <span className="self-center text-sm text-amber-500">{"★".repeat(x.review.rating)}</span>
        )}
      </div>
    </Card>
  );
}

export function CancelDialog({
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
  const now = useNow(15_000);
  const [reason, setReason] = useState("");
  const p = previewClientCancel(x.booking, x.tenders, policy, now);
  const act = useAction((key: string) =>
    api.cancel(x.booking.id, reason.trim() || "client canceled", key),
  );
  const refundTotal = p.refund.card + p.refund.points + p.refund.wallet + p.refund.promo;
  return (
    <Modal title="Cancel booking" onClose={onClose} testId="cancel-dialog">
      <p className="mb-3 text-sm text-slate-600">
        {p.outcome.hoursBefore >= 0 ? `${p.outcome.hoursBefore.toFixed(1)} hours` : "After"} before
        the original start ({fmtDateTime(x.booking.original_start_at, x.booking.location_tz)}).{" "}
        <span data-testid="cancel-tier">{p.tierText}</span>
      </p>
      {x.booking.original_start_at !== x.booking.start_at && (
        <Banner tone="info">Rescheduled bookings are measured from the original start time.</Banner>
      )}
      <div className="rounded-lg bg-slate-50 p-3">
        <MoneyRow label="Booking total" cents={Number(x.booking.total_cents)} />
        <MoneyRow
          label="Cancellation fee kept"
          cents={p.outcome.retainedCents}
          testId="cancel-fee"
          negative
        />
        <MoneyRow label="You get back" cents={refundTotal} testId="cancel-refund-total" strong />
        <div className="mt-2 text-xs font-semibold uppercase text-slate-500">Refund goes to</div>
        {(["card", "points", "wallet", "promo"] as const).map(
          (t) =>
            (paidParts(x.tenders)[t] > 0 || p.refund[t] > 0) && (
              <MoneyRow
                key={t}
                label={
                  t === "points"
                    ? `Points (returned as ${Math.floor(p.refund.points / policy.points.centsPerPoint)} pts)`
                    : TENDER_LABEL[t]
                }
                cents={p.refund[t]}
                testId={`cancel-refund-${t}`}
              />
            ),
        )}
      </div>
      <Field label="Reason (optional)" id="cancel-reason">
        <Input
          id="cancel-reason"
          data-testid="cancel-reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </Field>
      {act.error && (
        <Banner tone="error" testId="cancel-error">
          {act.error}
        </Banner>
      )}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          Keep booking
        </Button>
        <Button
          variant="danger"
          data-testid="cancel-confirm"
          disabled={act.pending}
          onClick={async () => {
            const r = await act.run();
            if (r) onDone(`Booking canceled. ${money(refundTotal)} is on its way back.`);
          }}
        >
          {act.pending ? "Canceling…" : `Cancel and refund ${money(refundTotal)}`}
        </Button>
      </div>
    </Modal>
  );
}

function toLocalInput(iso: string, tz: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(new Date(iso));
  const g = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  return `${g("year")}-${g("month")}-${g("day")}T${g("hour")}:${g("minute")}`;
}

export function RescheduleDialog({
  x,
  onClose,
  onDone,
}: {
  x: BookingBundle;
  onClose: () => void;
  onDone: (m: string) => void;
}) {
  const [localStart, setLocalStart] = useState(
    toLocalInput(x.booking.start_at, x.booking.location_tz),
  );
  const act = useAction((key: string) => api.reschedule(x.booking.id, localStart, key));
  return (
    <Modal title="Reschedule" onClose={onClose} testId="reschedule-dialog">
      <Field label={`New start (${x.booking.location_tz})`} id="resched">
        <Input
          id="resched"
          type="datetime-local"
          data-testid="reschedule-input"
          value={localStart}
          onChange={(e) => setLocalStart(e.target.value)}
        />
      </Field>
      <Banner tone="info">
        Cancellation fees are still measured from the original start time (
        {fmtDateTime(x.booking.original_start_at, x.booking.location_tz)}).
      </Banner>
      {act.error && (
        <Banner tone="error" testId="reschedule-error">
          {act.error}
        </Banner>
      )}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          Close
        </Button>
        <Button
          data-testid="reschedule-confirm"
          disabled={act.pending || !localStart}
          onClick={async () => {
            if (await act.run()) onDone("Booking rescheduled.");
          }}
        >
          Reschedule
        </Button>
      </div>
    </Modal>
  );
}

function TipDialog({
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
  const [amount, setAmount] = useState("");
  const cents = parseDollars(amount);
  const problem = amount ? tipProblem(cents, x.booking, policy, new Date()) : null;
  const act = useAction((key: string) => api.tip(x.booking.id, cents!, key));
  const cap = tipCap(Number(x.booking.subtotal_cents), policy);
  return (
    <Modal title={`Tip ${x.taskerName}`} onClose={onClose} testId="tip-dialog">
      <p className="mb-3 text-sm text-slate-600">
        100% of your tip goes to the tasker. Charged to your card. Up to {money(cap)} (
        {policy.tips.capBpsOfSubtotal / 100}% of the task subtotal), within {policy.tips.windowDays}{" "}
        days of completion.
      </p>
      <Field label="Tip amount ($)" id="tip">
        <Input
          id="tip"
          data-testid="tip-input"
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="10.00"
        />
      </Field>
      {problem && (
        <p className="mb-3 text-sm text-red-600" data-testid="tip-error">
          {problem}
        </p>
      )}
      {act.error && (
        <Banner tone="error" testId="tip-api-error">
          {act.error}
        </Banner>
      )}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          Close
        </Button>
        <Button
          data-testid="tip-confirm"
          disabled={!amount || !!problem || act.pending}
          onClick={async () => {
            if (await act.run()) onDone(`Thanks! ${money(cents)} tip sent.`);
          }}
        >
          {cents && !problem ? `Tip ${money(cents)}` : "Tip"}
        </Button>
      </div>
    </Modal>
  );
}

function ReviewDialog({
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
  const [rating, setRating] = useState(5);
  const [body, setBody] = useState("");
  const act = useAction((key: string) => api.review(x.booking.id, rating, body.trim(), key));
  return (
    <Modal title="Leave a review" onClose={onClose} testId="review-dialog">
      <p className="mb-3 text-sm text-slate-600">
        Earn {policy.points.reviewBonusPoints} bonus points for your first review of this booking.
      </p>
      <Field label="Rating" id="rating">
        <Select
          id="rating"
          data-testid="review-rating"
          value={rating}
          onChange={(e) => setRating(Number(e.target.value))}
        >
          {[5, 4, 3, 2, 1].map((r) => (
            <option key={r} value={r}>
              {"★".repeat(r)} ({r})
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Comments" id="review-body">
        <Textarea
          id="review-body"
          data-testid="review-body"
          rows={3}
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
      </Field>
      {act.error && <Banner tone="error">{act.error}</Banner>}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          Close
        </Button>
        <Button
          data-testid="review-submit"
          disabled={act.pending}
          onClick={async () => {
            if (await act.run()) onDone("Review posted.");
          }}
        >
          Post review
        </Button>
      </div>
    </Modal>
  );
}

function RefundRequestDialog({
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
  const [kind, setKind] = useState<RefundKind>("partial");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const cents = kind === "full" ? 0 : (parseDollars(amount) ?? 0);
  const pv = previewRefund(
    kind,
    cents,
    "client",
    reason || "-",
    undefined,
    x.booking,
    x.tenders,
    policy,
    false,
    new Date(),
  );
  const amt = kind === "full" ? pv.refundable : cents;
  const act = useAction((key: string) =>
    api.refund(x.booking.id, { kind, amountCents: amt, reason: reason.trim() }, key),
  );
  return (
    <Modal title="Request a refund" onClose={onClose} testId="refund-dialog">
      <p className="mb-3 text-sm text-slate-600">
        Refundable: <strong>{money(pv.refundable)}</strong>. Requests are reviewed by support;
        refunds return to the original payment methods in this order:{" "}
        {policy.refundOrder.map((t) => TENDER_LABEL[t]).join(" → ")}.
      </p>
      <Field label="Type" id="rk">
        <Select
          id="rk"
          data-testid="refund-kind"
          value={kind}
          onChange={(e) => setKind(e.target.value as RefundKind)}
        >
          <option value="partial">Partial</option>
          <option value="full">Full</option>
        </Select>
      </Field>
      {kind === "partial" && (
        <Field label="Amount ($)" id="ra">
          <Input
            id="ra"
            data-testid="refund-amount"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </Field>
      )}
      <Field label="What went wrong?" id="rr">
        <Textarea
          id="rr"
          data-testid="refund-reason"
          rows={3}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </Field>
      {pv.plan && amt > 0 && (
        <div className="mb-3 rounded-lg bg-slate-50 p-3" data-testid="refund-preview">
          {(["card", "wallet", "points", "promo"] as const)
            .filter((t) => pv.plan!.perTender[t] > 0)
            .map((t) => (
              <MoneyRow key={t} label={`To ${TENDER_LABEL[t]}`} cents={pv.plan!.perTender[t]} />
            ))}
          <MoneyRow label="Total" cents={amt} strong />
        </div>
      )}
      {pv.error && amt > 0 && pv.error !== "refund reason is required" && (
        <p className="mb-3 text-sm text-red-600" data-testid="refund-error">
          {pv.error}
        </p>
      )}
      {act.error && <Banner tone="error">{act.error}</Banner>}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          Close
        </Button>
        <Button
          data-testid="refund-submit"
          disabled={act.pending || !reason.trim() || amt <= 0 || !pv.plan}
          onClick={async () => {
            if (await act.run()) onDone("Refund request sent.");
          }}
        >
          Submit request
        </Button>
      </div>
    </Modal>
  );
}
