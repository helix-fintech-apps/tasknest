// Pure parts of the UI kit and shell: the chip vocabulary, reconcile diff, requirements, nav per role,
// provider label, and the API client's idempotent-replay hook.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { STATUS_CHIPS, StatusChip } from "../../src/components/ui/StatusChip";
import { ReconcileBanner } from "../../src/components/ui/ReconcileBanner";
import { RequirementsList } from "../../src/components/ui/RequirementsList";
import { Stepper } from "../../src/components/ui/Stepper";
import { navFor, topNavFor } from "../../src/components/shell/nav";
import { providerLabel } from "../../src/lib/health";
import { cx } from "../../src/components/ui/cx";

const text = (el: Parameters<typeof renderToStaticMarkup>[0]) =>
  renderToStaticMarkup(el).replace(/<[^>]+>/g, "");

describe("StatusChip", () => {
  it("always shows the label as text, with the glossary wording", () => {
    expect(text(createElement(StatusChip, { status: "pending_payment" }))).toBe(
      "Finishing payment",
    );
    expect(text(createElement(StatusChip, { status: "action_required" }))).toBe(
      "Payment needs your approval",
    );
    expect(
      text(
        createElement(StatusChip, { status: "hold_active", detail: "$83.50 · releases by Nov 9" }),
      ),
    ).toBe("Hold $83.50 · releases by Nov 9");
    expect(
      text(createElement(StatusChip, { status: "requested", label: "Waiting for Tara" })),
    ).toBe("Waiting for Tara");
  });

  it("falls back to a neutral chip with the raw status for unknown values", () => {
    const out = renderToStaticMarkup(createElement(StatusChip, { status: "mystery_state" }));
    expect(out).toContain("mystery state");
    expect(out).toContain('data-status="mystery_state"');
  });

  it("maps tones as the glossary says", () => {
    expect(STATUS_CHIPS.accepted.tone).toBe("success");
    expect(STATUS_CHIPS.hold_active.tone).toBe("hold");
    expect(STATUS_CHIPS.disputed.tone).toBe("danger");
    expect(STATUS_CHIPS.refund_pending.tone).toBe("warning");
    expect(STATUS_CHIPS.payout_failed.tone).toBe("danger");
    expect(STATUS_CHIPS.paying_out.tone).toBe("info");
  });
});

describe("ReconcileBanner", () => {
  const preview = [
    { key: "total", label: "Total", cents: 10350, kind: "total" as const },
    { key: "fee", label: "Service fee", cents: 1350, kind: "service_fee" as const },
  ];
  it("says 'Settled as previewed' when every line matches", () => {
    expect(text(createElement(ReconcileBanner, { preview, result: preview }))).toBe(
      "Settled as previewed.",
    );
  });
  it("lists only the lines that differ, with exact cents", () => {
    const out = renderToStaticMarkup(
      createElement(ReconcileBanner, {
        preview,
        result: [preview[0], { ...preview[1], cents: 1400 }],
      }),
    );
    expect(out).toContain("Service fee");
    expect(out).toContain('data-money-cents="1350"');
    expect(out).toContain('data-money-cents="1400"');
    expect(out).not.toContain("Settled as previewed");
    expect(out).not.toContain('data-money-cents="10350"');
  });
});

describe("RequirementsList", () => {
  it("renders nothing when everything is met", () => {
    expect(
      renderToStaticMarkup(
        createElement(RequirementsList, { items: [{ id: "a", label: "Pick a time", met: true }] }),
      ),
    ).toBe("");
  });
  it("lists unmet items first and names them for screen readers", () => {
    const out = renderToStaticMarkup(
      createElement(RequirementsList, {
        items: [
          { id: "a", label: "Add an address", met: true },
          { id: "b", label: "Pick a time", met: false },
        ],
      }),
    );
    expect(out.indexOf("Pick a time")).toBeLessThan(out.indexOf("Add an address"));
    expect(out).toContain("(needed)");
    expect(out).toContain("(done)");
  });
});

describe("Stepper", () => {
  it("marks done, current and todo steps", () => {
    const out = renderToStaticMarkup(
      createElement(Stepper, {
        steps: [
          { id: "a", label: "One" },
          { id: "b", label: "Two" },
          { id: "c", label: "Three" },
        ],
        current: "b",
      }),
    );
    expect(out).toContain('data-state="done"');
    expect(out).toContain('data-state="current"');
    expect(out).toContain('data-state="todo"');
    expect(out).toContain('aria-current="step"');
  });
});

describe("navigation per role", () => {
  it("keeps the ids the e2e suite and Helix rely on", () => {
    const client = navFor("client").map((n) => n.testId);
    expect(client).toEqual(
      expect.arrayContaining(["nav-taskers", "nav-bookings", "nav-points", "nav-messages"]),
    );
    expect(navFor("tasker").map((n) => n.testId)).toContain("nav-tasker");
    expect(navFor("admin").map((n) => n.testId)).toContain("nav-console");
    expect(navFor("support_agent").map((n) => n.testId)).toContain("nav-console");
    expect(navFor(undefined).map((n) => n.testId)).toEqual(
      expect.arrayContaining(["nav-pricing", "nav-services", "nav-help"]),
    );
  });
  it("shows admin-only sections to admins, not support agents", () => {
    const admin = navFor("admin").map((n) => n.label);
    const agent = navFor("support_agent").map((n) => n.label);
    for (const l of ["Payouts", "Policies", "Health", "Reconciliation", "Test tools"]) {
      expect(admin).toContain(l);
      expect(agent).not.toContain(l);
    }
  });
  it("gives phones five client tabs: Book, Tasks, Messages, Rewards, Account", () => {
    expect(navFor("client").map((n) => n.tab ?? n.label)).toEqual([
      "Book",
      "Tasks",
      "Messages",
      "Rewards",
      "Account",
    ]);
    expect(topNavFor("client").map((n) => n.label)).not.toContain("Account");
  });
});

describe("providerLabel", () => {
  it("names the payments mode", () => {
    expect(providerLabel("fake")).toBe("Payments: Simulated");
    expect(providerLabel("stripe")).toBe("Payments: Stripe test");
    expect(providerLabel(undefined)).toBeNull();
  });
});

describe("cx", () => {
  it("joins truthy parts only", () => {
    expect(cx("a", false, null, undefined, "b")).toBe("a b");
  });
});

describe("api client: Idempotent-Replayed", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("notifies listeners when the API replays a stored answer, and not otherwise", async () => {
    const { call, onIdempotentReplay } = await import("../../src/lib/api/core");
    const seen = vi.fn();
    const off = onIdempotentReplay(seen);

    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () => new Response("{}", { status: 200, headers: { "Idempotent-Replayed": "true" } }),
      ),
    );
    await call("POST", "/x", {});
    expect(seen).toHaveBeenCalledTimes(1);

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 200 })),
    );
    await call("POST", "/x", {});
    expect(seen).toHaveBeenCalledTimes(1);

    off();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () => new Response("{}", { status: 200, headers: { "Idempotent-Replayed": "true" } }),
      ),
    );
    await call("POST", "/x", {});
    expect(seen).toHaveBeenCalledTimes(1);
  });
});
