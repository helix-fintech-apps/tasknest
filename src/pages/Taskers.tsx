import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { listTaskers } from "../lib/data";
import { money } from "../lib/format";
import { Banner, Card, Empty, H1, Input, Select, Spinner, useLoad } from "../components/ui";

export default function Taskers() {
  const { data, error, loading } = useLoad(() => listTaskers(), []);
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("");
  const cats = useMemo(() => [...new Set((data ?? []).map((t) => t.category))].sort(), [data]);
  const shown = (data ?? []).filter((t) => (!cat || t.category === cat) && `${t.name} ${t.headline} ${t.category}`.toLowerCase().includes(q.toLowerCase()));

  return (
    <div>
      <H1 sub="Vetted, active taskers. Prices are hourly; a service fee is added at checkout.">Find a tasker</H1>
      <div className="mb-5 flex flex-wrap gap-3">
        <Input data-testid="tasker-search" placeholder="Search by name or skill" value={q} onChange={(e) => setQ(e.target.value)} className="max-w-xs" />
        <Select data-testid="tasker-category" value={cat} onChange={(e) => setCat(e.target.value)} className="max-w-[12rem]">
          <option value="">All categories</option>
          {cats.map((c) => <option key={c}>{c}</option>)}
        </Select>
      </div>
      {error && <Banner tone="error">{error}</Banner>}
      {loading ? <Spinner /> : shown.length === 0 ? <Empty>No taskers match.</Empty> : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" data-testid="tasker-list">
          {shown.map((t) => (
            <Link key={t.id} to={`/taskers/${t.id}`} data-testid={`tasker-card-${t.name.split(" ")[0].toLowerCase()}`}>
              <Card className="h-full transition hover:border-blue-300 hover:shadow">
                <div className="flex items-center gap-3">
                  <div className="flex h-11 w-11 items-center justify-center rounded-full bg-blue-100 font-semibold text-blue-700">{t.name.charAt(0)}</div>
                  <div>
                    <div className="font-semibold text-slate-900">{t.name}</div>
                    <div className="text-xs text-slate-500">{t.category}</div>
                  </div>
                  <div className="ml-auto text-right">
                    <div className="font-semibold text-blue-700">{money(t.hourly_rate_cents)}</div>
                    <div className="text-xs text-slate-500">per hour</div>
                  </div>
                </div>
                {t.headline && <p className="mt-3 text-sm text-slate-600">{t.headline}</p>}
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
