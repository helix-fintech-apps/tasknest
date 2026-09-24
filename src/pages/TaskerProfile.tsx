import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api, errorMessage, type QuoteResponse } from "../lib/api";
import { useAuth } from "../lib/auth";
import { clientHasBookings, getPromo, getTasker, pointsLots, promoUsed, taskerReviews } from "../lib/data";
import { fmtMinutes, money } from "../lib/format";
import { useActivePolicy } from "../lib/policy";
import { pointsSummary, previewQuote } from "../lib/preview";
import type { PromoCodeRow } from "../lib/supabase";
import { Badge, Banner, Button, Card, Field, H2, Input, MoneyRow, Select, Spinner, Textarea, useAction, useLoad } from "../components/ui";

const TZS = ["America/Los_Angeles", "America/Denver", "America/Chicago", "America/New_York", "Europe/London", "UTC"];
const DURATIONS = Array.from({ length: 16 }, (_, i) => (i + 2) * 30); // 1h .. 8.5h

function defaultStart(): string {
  const d = new Date(Date.now() + 3 * 86_400_000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T10:00`;
}

export default function TaskerProfile() {
  const { id = "" } = useParams();
  const { profile } = useAuth();
  const nav = useNavigate();
  const { policy, source, loading: policyLoading, row } = useActivePolicy();
  const tasker = useLoad(() => getTasker(id), [id]);
  const reviews = useLoad(() => taskerReviews(id), [id]);
  const lots = useLoad(() => (profile ? pointsLots(profile.id) : Promise.resolve([])), [profile?.id]);
  const firstTask = useLoad(() => (profile ? clientHasBookings(profile.id).then((has) => !has) : Promise.resolve(true)), [profile?.id]);

  const [minutes, setMinutes] = useState(120);
  const [localStart, setLocalStart] = useState(defaultStart());
  const [tz, setTz] = useState(profile?.home_tz || "America/Los_Angeles");
  const [description, setDescription] = useState("");
  const [promoInput, setPromoInput] = useState("");
  const [promo, setPromo] = useState<{ code: string; row: PromoCodeRow | null; used: boolean } | null>(null);
  const [usePoints, setUsePoints] = useState(false);
  const [pointsInput, setPointsInput] = useState("");
  const [server, setServer] = useState<{ state: "idle" | "loading" | "ok" | "error"; data?: QuoteResponse; error?: string }>({ state: "idle" });

  const pointsBalance = useMemo(() => Math.max(0, pointsSummary(lots.data ?? [], new Date()).availableNet), [lots.data]);

  // Look up a promo code when it's entered.
  useEffect(() => {
    const code = promoInput.trim().toUpperCase();
    if (!code) { setPromo(null); return; }
    let alive = true;
    const t = setTimeout(async () => {
      try {
        const [row, used] = await Promise.all([getPromo(code), profile ? promoUsed(profile.id, code) : Promise.resolve(false)]);
        if (alive) setPromo({ code, row, used });
      } catch {
        if (alive) setPromo({ code, row: null, used: false });
      }
    }, 250);
    return () => { alive = false; clearTimeout(t); };
  }, [promoInput, profile]);

  const pointsRequested = usePoints ? Math.max(0, Math.floor(Number(pointsInput) || 0)) : 0;
  const promoCode = promoInput.trim().toUpperCase();
  const t = tasker.data;

  const preview = useMemo(() => {
    if (!t || !policy) return null;
    return previewQuote({
      rateCents: Number(t.hourly_rate_cents), minutes, policy,
      promo: promo && promo.code === promoCode ? promo.row : null,
      promoCodeEntered: promo && promo.code === promoCode ? promoCode : "",
      isFirstTask: firstTask.data ?? false, promoAlreadyUsed: promo?.used ?? false,
      pointsRequested, pointsBalance, walletCents: 0, now: new Date(),
    });
  }, [t, policy, minutes, promo, promoCode, firstTask.data, pointsRequested, pointsBalance]);

  // Ask the server for its quote too (source of truth); flag any mismatch with the preview.
  const promoOk = !!preview && !preview.promoError;
  useEffect(() => {
    if (!t || !preview?.quote || preview.allocationError) return;
    let alive = true;
    setServer({ state: "loading" });
    const timer = setTimeout(() => {
      api.quote({ taskerId: t.id, minutes, promoCode: promoCode && promoOk ? promoCode : undefined, pointsRequested: pointsRequested || undefined })
        .then((data) => alive && setServer({ state: "ok", data }))
        .catch((e) => alive && setServer({ state: "error", error: errorMessage(e) }));
    }, 400);
    return () => { alive = false; clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t?.id, minutes, promoCode, promoOk, pointsRequested, preview?.allocationError]);

  const book = useAction((key: string) => api.createBooking({
    taskerId: id, localStart, tz, minutes, description: description.trim(),
    promoCode: promoCode && promoOk ? promoCode : undefined,
    pointsRequested: pointsRequested || undefined,
  }, key));

  if (tasker.loading || policyLoading) return <Spinner />;
  if (tasker.error) return <Banner tone="error">{tasker.error}</Banner>;
  if (!t) return <Banner tone="warning">This tasker isn't available.</Banner>;

  const q = preview?.quote;
  const alloc = preview?.allocation;
  const serverTotal = server.data?.quote?.total;
  const serverCard = server.data?.allocation?.parts?.card;
  const mismatch = server.state === "ok" && q && alloc && (serverTotal !== q.total || (serverCard !== undefined && serverCard !== alloc.parts.card));
  const isClient = profile?.role === "client";
  const canBook = isClient && t.status === "active" && !!q && !!alloc && !preview?.promoError && !preview?.allocationError && description.trim().length > 0 && !!localStart;
  const avgRating = reviews.data?.length ? reviews.data.reduce((a, r) => a + r.rating, 0) / reviews.data.length : null;

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
      <div className="space-y-6">
        <Card>
          <div className="flex items-center gap-4">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-blue-100 text-2xl font-semibold text-blue-700">{t.name.charAt(0)}</div>
            <div>
              <h1 className="text-2xl font-semibold text-slate-900" data-testid="tasker-name">{t.name}</h1>
              <div className="text-sm text-slate-500">{t.category} · <span data-testid="tasker-rate">{money(t.hourly_rate_cents)}/h</span> · <Badge value={t.status} /></div>
              {avgRating !== null && <div className="text-sm text-slate-500">★ {avgRating.toFixed(1)} ({reviews.data!.length} reviews)</div>}
            </div>
          </div>
          {t.headline && <p className="mt-4 text-slate-600">{t.headline}</p>}
        </Card>

        <Card>
          <H2>Book {t.name.split(" ")[0]}</H2>
          {!isClient && <Banner tone="info">Only client accounts can book. You can still preview the price.</Banner>}
          <div className="grid gap-x-4 sm:grid-cols-2">
            <Field label="Start (local time)" id="start">
              <Input id="start" data-testid="booking-start" type="datetime-local" value={localStart} onChange={(e) => setLocalStart(e.target.value)} />
            </Field>
            <Field label="Time zone of the task location" id="tz">
              <Select id="tz" data-testid="booking-tz" value={tz} onChange={(e) => setTz(e.target.value)}>
                {[...new Set([tz, ...TZS])].map((z) => <option key={z}>{z}</option>)}
              </Select>
            </Field>
            <Field label="Estimated duration" id="duration">
              <Select id="duration" data-testid="booking-duration" value={minutes} onChange={(e) => setMinutes(Number(e.target.value))}>
                {DURATIONS.map((m) => <option key={m} value={m}>{fmtMinutes(m)}</option>)}
              </Select>
            </Field>
            <Field label="Promo code" id="promo" hint={preview?.promoError ? <span className="text-red-600" data-testid="promo-error">{preview.promoError}</span> : preview?.discountCents ? <span className="text-emerald-700">Applied: −{money(preview.discountCents)}</span> : undefined}>
              <Input id="promo" data-testid="promo-input" placeholder="e.g. WELCOME10" value={promoInput} onChange={(e) => setPromoInput(e.target.value)} />
            </Field>
          </div>
          <Field label="Describe the task" id="desc">
            <Textarea id="desc" data-testid="booking-description" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. Mount a 55&quot; TV on drywall" />
          </Field>
          <div className="rounded-lg border border-slate-200 p-3">
            <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
              <input type="checkbox" data-testid="points-toggle" checked={usePoints} onChange={(e) => {
                setUsePoints(e.target.checked);
                if (e.target.checked && !pointsInput && q) setPointsInput(String(Math.min(pointsBalance, Math.floor(q.total / (policy?.points.centsPerPoint || 1)))));
              }} />
              Use loyalty points <span className="font-normal text-slate-500">(<span data-testid="points-available">{pointsBalance.toLocaleString()}</span> available)</span>
            </label>
            {usePoints && (
              <div className="mt-2">
                <Input data-testid="points-input" inputMode="numeric" value={pointsInput} onChange={(e) => setPointsInput(e.target.value.replace(/[^0-9]/g, ""))} className="max-w-[10rem]" />
                <p className="mt-1 text-xs text-slate-500">
                  Minimum {policy?.points.minRedeemPoints} points · 1 point = {money(policy?.points.centsPerPoint ?? 1)} · points are reserved now and redeemed when the task completes.
                </p>
              </div>
            )}
            {preview?.allocationError && <p className="mt-2 text-sm text-red-600" data-testid="points-error">{preview.allocationError}</p>}
          </div>
          {book.error && <div className="mt-4"><Banner tone="error" testId="booking-error">{book.error}</Banner></div>}
          <Button data-testid="book-submit" className="mt-4 w-full" disabled={!canBook || book.pending} onClick={async () => {
            const r = await book.run();
            if (r) nav("/bookings", { state: { flash: "Booking requested. Your card is authorized, not charged, until the task is done." } });
          }}>
            {book.pending ? "Booking…" : q ? `Request booking · ${money(q.total)}` : "Request booking"}
          </Button>
          <p className="mt-2 text-xs text-slate-500">Your card is authorized now and captured when the task is completed. See <a className="text-blue-700 underline" href="/pricing">pricing & policies</a> for the cancellation curve.</p>
        </Card>

        {!!reviews.data?.length && (
          <Card>
            <H2>Reviews</H2>
            <ul className="space-y-3">{reviews.data.map((r) => <li key={r.booking_id} className="text-sm"><span className="text-amber-500">{"★".repeat(r.rating)}</span> <span className="text-slate-600">{r.body}</span></li>)}</ul>
          </Card>
        )}
      </div>

      <aside>
        <Card className="sticky top-4" data-testid="quote-panel">
          <H2>Price details</H2>
          {!q ? <p className="text-sm text-slate-500">{preview?.error ?? "—"}</p> : (
            <>
              <MoneyRow label={`${money(t.hourly_rate_cents)}/h × ${fmtMinutes(minutes)}`} cents={q.subtotal} testId="quote-subtotal" />
              <MoneyRow label={`Service fee (${(policy!.clientServiceFeeBps / 100)}%)`} cents={q.serviceFee} testId="quote-service-fee" />
              <MoneyRow label="Tax" cents={q.tax} testId="quote-tax" />
              <MoneyRow label="Total" cents={q.total} testId="quote-total" strong />
              <div className="mt-4 text-xs font-semibold uppercase tracking-wide text-slate-500">Paid with</div>
              {alloc ? (
                <div data-testid="quote-tenders">
                  <MoneyRow label="Promo credit" cents={alloc.parts.promo} testId="quote-promo" muted={!alloc.parts.promo} />
                  <MoneyRow label={`Points${alloc.pointsUsed ? ` (${alloc.pointsUsed.toLocaleString()} pts)` : ""}`} cents={alloc.parts.points} testId="quote-points" muted={!alloc.parts.points} />
                  <MoneyRow label="Wallet" cents={alloc.parts.wallet} testId="quote-wallet" muted={!alloc.parts.wallet} />
                  <MoneyRow label="Card" cents={alloc.parts.card} testId="quote-card" strong />
                </div>
              ) : <p className="text-sm text-red-600">{preview?.allocationError}</p>}
              <div className="mt-3 text-xs" data-testid="quote-server-status">
                {server.state === "loading" && <span className="text-slate-400">Confirming with server…</span>}
                {server.state === "ok" && !mismatch && <span className="text-emerald-700">✓ Server quote matches</span>}
                {mismatch && <span className="text-red-600" data-testid="quote-mismatch">Server quote differs: total {money(serverTotal)} · card {money(serverCard)}. The server amount is what you'll be charged.</span>}
                {server.state === "error" && <span className="text-slate-400">Server quote unavailable ({server.error}). Preview only.</span>}
              </div>
              <p className="mt-3 text-xs text-slate-400">Policy v{row?.version ?? policy?.version}{source === "builtin" && " (built-in copy — policy table unreachable)"}.</p>
            </>
          )}
        </Card>
      </aside>
    </div>
  );
}
