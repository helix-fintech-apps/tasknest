// The <Money> component: the machine-readable contract (plan section 4.5) that e2e tests and Helix read.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Money, MONEY_KINDS } from "../../src/components/ui/Money";

const html = (props: Parameters<typeof Money>[0]) =>
  renderToStaticMarkup(createElement(Money, props));

describe("<Money>", () => {
  it("renders the contract attributes and formatted text", () => {
    const out = html({
      cents: 8350,
      kind: "card_hold",
      tender: "card",
      source: "server",
      policyVersion: 2,
    });
    expect(out).toContain('data-money-cents="8350"');
    expect(out).toContain('data-money-kind="card_hold"');
    expect(out).toContain('data-tender="card"');
    expect(out).toContain('data-source="server"');
    expect(out).toContain('data-policy-version="2"');
    expect(out).toContain(">$83.50<");
    expect(out).not.toContain("data-money-sign");
  });

  it("defaults the source to server and omits optional attributes", () => {
    const out = html({ cents: 100, kind: "tip" });
    expect(out).toContain('data-source="server"');
    expect(out).not.toContain("data-tender");
    expect(out).not.toContain("data-policy-version");
  });

  it("marks a browser preview", () => {
    expect(html({ cents: 500, kind: "total", source: "browser" })).toContain(
      'data-source="browser"',
    );
  });

  it("puts the test id on the money element itself, so toHaveText keeps matching", () => {
    const out = html({ cents: 10350, kind: "total", testId: "booking-total" });
    expect(out).toContain('data-testid="booking-total"');
    // The element's whole text is the amount (no wrapper text), so toHaveText("$103.50") matches.
    expect(out.replace(/<[^>]+>/g, "")).toBe("$103.50");
  });

  it("shows a negative amount with a real minus sign and an aria-label, magnitude in the attribute", () => {
    const out = html({ cents: -2000, kind: "refund" });
    expect(out).toContain('data-money-cents="2000"');
    expect(out).toContain('data-money-sign="minus"');
    expect(out).toContain('role="img" aria-label="minus">−</span>');
    expect(out.replace(/<[^>]+>/g, "")).toBe("−$20.00");
  });

  it("sign=minus shows a positive amount as a deduction; zero never shows a sign", () => {
    expect(html({ cents: 1000, kind: "promo", sign: "minus" }).replace(/<[^>]+>/g, "")).toBe(
      "−$10.00",
    );
    const zero = html({ cents: 0, kind: "promo", sign: "minus" });
    expect(zero).not.toContain("minus");
    expect(zero.replace(/<[^>]+>/g, "")).toBe("$0.00");
  });

  it("sign=plus adds a plus for positive amounts only", () => {
    expect(html({ cents: 1000, kind: "tip", sign: "plus" }).replace(/<[^>]+>/g, "")).toBe(
      "+$10.00",
    );
    expect(html({ cents: 0, kind: "tip", sign: "plus" }).replace(/<[^>]+>/g, "")).toBe("$0.00");
  });

  it("uses tabular numerals", () => {
    expect(html({ cents: 1, kind: "fee" })).toContain("tabular-nums");
  });

  it("formats thousands and sub-dollar amounts exactly", () => {
    expect(html({ cents: 123456789, kind: "balance" }).replace(/<[^>]+>/g, "")).toBe(
      "$1,234,567.89",
    );
    expect(html({ cents: 5, kind: "fee" }).replace(/<[^>]+>/g, "")).toBe("$0.05");
  });

  it("accepts every kind in the contract", () => {
    expect(MONEY_KINDS).toHaveLength(24);
    for (const kind of MONEY_KINDS)
      expect(html({ cents: 1, kind })).toContain(`data-money-kind="${kind}"`);
  });
});
