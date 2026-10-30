import { useState } from "react";
import {
  Avatar,
  Banner,
  Button,
  Card,
  Combobox,
  CountdownChip,
  DataTable,
  Dialog,
  EmptyState,
  Field,
  H1,
  H2,
  HoldChip,
  Input,
  Money,
  MONEY_KINDS,
  RatingStars,
  ReconcileBanner,
  RequirementsList,
  Select,
  Sheet,
  SimulatedBadge,
  Skeleton,
  STATUS_CHIPS,
  Stepper,
  StatusChip,
  Tabs,
  Textarea,
  useToast,
} from "../components/ui";

const SWATCHES = [
  ["Primary", "bg-primary text-on-primary"],
  ["Surface muted", "bg-surface-muted text-fg"],
  ["Info", "bg-info-bg text-info"],
  ["Success", "bg-success-bg text-success"],
  ["Warning", "bg-warning-bg text-warning"],
  ["Danger", "bg-danger-bg text-danger"],
  ["Hold", "bg-hold-bg text-hold"],
];
const CATS = [
  { value: "cleaning", label: "Cleaning" },
  { value: "handyman", label: "Handyman" },
  { value: "moving", label: "Moving" },
  { value: "yard", label: "Yardwork" },
];
const STEPS = [
  { id: "task", label: "Task" },
  { id: "time", label: "Time" },
  { id: "pay", label: "Review & pay" },
];

/** A living style guide: every kit component in every state. Also what the axe suite checks. */
export default function DesignSystem() {
  const toast = useToast();
  const [dialog, setDialog] = useState<null | "dialog" | "sheet">(null);
  const [rating, setRating] = useState(4);
  const [cat, setCat] = useState<string | null>("cleaning");
  const [name, setName] = useState("");
  const inHour = new Date(Date.now() + 50 * 60_000).toISOString();
  const inDay = new Date(Date.now() + 26 * 3_600_000).toISOString();
  const rows = [
    { id: "a", who: "Tara Tasker", what: "Mount TV", cents: 10350 },
    { id: "b", who: "Leo Tasker", what: "Deep clean", cents: 7600 },
  ];

  return (
    <div className="space-y-10">
      <H1 sub="Tokens, components and states. Light and dark follow the account menu.">
        Design system
      </H1>

      <section aria-labelledby="ds-colour" className="space-y-3">
        <H2>
          <span id="ds-colour">Colour</span>
        </H2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {SWATCHES.map(([label, cls]) => (
            <div key={label} className={`rounded-xl p-4 text-sm font-semibold ${cls}`}>
              {label}
            </div>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <H2>Buttons</H2>
        <div className="flex flex-wrap gap-2">
          <Button>Primary</Button>
          <Button variant="accent">Accent</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="danger">Danger</Button>
          <Button variant="ghost">Ghost</Button>
          <Button disabled>Disabled</Button>
          <Button loading>Saving</Button>
          <Button size="sm">Small</Button>
          <Button size="lg">Large</Button>
        </div>
      </section>

      <section className="space-y-3">
        <H2>Money</H2>
        <Card>
          <ul className="grid gap-1 text-sm sm:grid-cols-2">
            <li>
              Subtotal <Money cents={9000} kind="subtotal" />
            </li>
            <li>
              Service fee <Money cents={1350} kind="service_fee" />
            </li>
            <li>
              Promo <Money cents={1000} kind="promo" sign="minus" />
            </li>
            <li>
              Refund <Money cents={-2000} kind="refund" />
            </li>
            <li>
              Total <Money cents={10350} kind="total" policyVersion={2} />
            </li>
            <li>
              Preview <Money cents={10350} kind="total" source="browser" />
            </li>
          </ul>
          <p className="mt-3 text-xs text-muted">{MONEY_KINDS.length} kinds in the contract.</p>
        </Card>
        <div className="flex flex-wrap gap-2">
          <HoldChip
            state="hold_active"
            amountCents={8350}
            captureBefore={new Date(Date.now() + 7 * 86_400_000).toISOString()}
          />
          <HoldChip
            state="card_saved"
            amountCents={8350}
            holdAt={new Date(Date.now() + 20 * 86_400_000).toISOString()}
          />
          <SimulatedBadge />
        </div>
        <ReconcileBanner
          preview={[{ key: "total", label: "Total", cents: 10350, kind: "total" }]}
          result={[{ key: "total", label: "Total", cents: 10350, kind: "total" }]}
        />
        <ReconcileBanner
          preview={[{ key: "fee", label: "Service fee", cents: 1350, kind: "service_fee" }]}
          result={[{ key: "fee", label: "Service fee", cents: 1400, kind: "service_fee" }]}
        />
      </section>

      <section className="space-y-3">
        <H2>Status chips</H2>
        <div className="flex flex-wrap gap-2" data-testid="chip-gallery">
          {Object.keys(STATUS_CHIPS).map((k) => (
            <StatusChip key={k} status={k} />
          ))}
          <CountdownChip until={inHour} />
          <CountdownChip until={inDay} />
        </div>
      </section>

      <section className="space-y-3">
        <H2>Banners and toasts</H2>
        <Banner tone="info">Info: a neutral note.</Banner>
        <Banner tone="success">Success: it worked.</Banner>
        <Banner tone="warning">Warning: check this.</Banner>
        <Banner tone="error">Error: something failed.</Banner>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            data-testid="ds-toast"
            onClick={() => toast.show("Booking canceled. $70.00 is on its way back to your card.")}
          >
            Show a toast
          </Button>
          <Button
            variant="secondary"
            data-testid="ds-refund-toast"
            onClick={() => toast.show("Refunded $70.00", { kind: "refund-flash" })}
          >
            Show a refund toast
          </Button>
        </div>
      </section>

      <section className="space-y-3">
        <H2>Forms</H2>
        <Card className="grid gap-x-6 sm:grid-cols-2">
          <Field label="Full name" hint="As it appears on your ID." required>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Email" error="Enter a valid email address.">
            <Input type="email" defaultValue="not-an-email" />
          </Field>
          <Field label="Duration">
            <Select defaultValue="120">
              <option value="60">1 hour</option>
              <option value="120">2 hours</option>
            </Select>
          </Field>
          <Combobox label="Category" options={CATS} value={cat} onChange={setCat} />
          <div className="sm:col-span-2">
            <Field label="Describe the task">
              <Textarea rows={3} />
            </Field>
          </div>
          <div>
            <p className="mb-1 text-sm font-medium text-fg">Rating</p>
            <RatingStars value={rating} onChange={setRating} label="Your rating" />
          </div>
          <div>
            <p className="mb-1 text-sm font-medium text-fg">Display</p>
            <RatingStars value={4.8} count={126} />
          </div>
        </Card>
        <RequirementsList
          items={[
            { id: "addr", label: "Add the task address", met: false },
            { id: "time", label: "Pick a time", met: true },
          ]}
        />
      </section>

      <section className="space-y-3">
        <H2>Navigation parts</H2>
        <Stepper steps={STEPS} current="time" />
        <Tabs
          label="Example tabs"
          tabs={[
            { id: "upcoming", label: "Upcoming", count: 2 },
            { id: "past", label: "Past", count: 5 },
            { id: "cancelled", label: "Cancelled" },
          ]}
        >
          {(id) => <p className="text-sm text-muted">The {id} tab.</p>}
        </Tabs>
      </section>

      <section className="space-y-3">
        <H2>Table</H2>
        <DataTable
          caption="Example bookings"
          columns={[
            { key: "who", header: "Tasker", cell: (r) => r.who },
            { key: "what", header: "Task", cell: (r) => r.what },
            {
              key: "amt",
              header: "Total",
              align: "right",
              cell: (r) => <Money cents={r.cents} kind="total" />,
            },
          ]}
          rows={rows}
          rowKey={(r) => r.id}
          rowProps={(r) => ({ "data-booking-id": r.id })}
        />
      </section>

      <section className="space-y-3">
        <H2>People and loading</H2>
        <div className="flex flex-wrap items-center gap-4">
          <Avatar name="Tara Tasker" />
          <Avatar name="Leo Tasker" />
          <Avatar name="Ava" size={56} />
          <div className="w-48 space-y-2" role="status" aria-label="Loading example">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        </div>
        <EmptyState title="Nothing here yet">Your tasks will show up here.</EmptyState>
      </section>

      <section className="space-y-3">
        <H2>Overlays</H2>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            data-testid="ds-open-dialog"
            onClick={() => setDialog("dialog")}
          >
            Open a dialog
          </Button>
          <Button
            variant="secondary"
            data-testid="ds-open-sheet"
            onClick={() => setDialog("sheet")}
          >
            Open a sheet
          </Button>
        </div>
        {dialog === "dialog" && (
          <Dialog
            title="Cancel booking"
            description="You get back $70.00."
            testId="ds-dialog"
            onClose={() => setDialog(null)}
            footer={
              <>
                <Button variant="secondary" onClick={() => setDialog(null)}>
                  Keep it
                </Button>
                <Button variant="danger" onClick={() => setDialog(null)}>
                  Cancel booking
                </Button>
              </>
            }
          >
            <Field label="Reason">
              <Input />
            </Field>
          </Dialog>
        )}
        {dialog === "sheet" && (
          <Sheet title="Filters" testId="ds-sheet" onClose={() => setDialog(null)}>
            <p className="text-sm text-muted">Sheets rise from the bottom on phones.</p>
          </Sheet>
        )}
      </section>
    </div>
  );
}
