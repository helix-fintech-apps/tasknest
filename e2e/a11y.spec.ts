// Accessibility baseline: axe (WCAG 2.2 AA) on every route, in light and dark, at 1280 px (chromium
// project) and 390 px (phone project). Also: no horizontal scroll and no console errors per route.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { IDS, mockBackend, signIn } from "./mock-backend";

type Who = "public" | "ava" | "tara" | "pia" | "admin" | "agent";
interface RouteCase {
  path: string;
  who: Who;
  /** Where we should end up (redirects), default: same as path. */
  lands?: string;
  name: string;
}

const ROUTES: RouteCase[] = [
  { name: "sign in", path: "/signin", who: "public" },
  { name: "pricing (public)", path: "/pricing", who: "public" },
  { name: "planned page (coming soon)", path: "/services", who: "public" },
  { name: "design system (every kit component)", path: "/design-system", who: "public" },
  { name: "404", path: "/no-such-page", who: "public" },
  { name: "client: find a tasker", path: "/taskers", who: "ava" },
  { name: "client: tasker profile", path: `/taskers/${IDS.tara}`, who: "ava" },
  { name: "client: my tasks", path: "/bookings", who: "ava" },
  { name: "client: rewards", path: "/rewards", who: "ava" },
  { name: "client: /points redirects to rewards", path: "/points", who: "ava", lands: "/rewards" },
  { name: "tasker: today", path: "/tasker", who: "tara" },
  { name: "tasker: pending (KYC) today", path: "/tasker", who: "pia" },
  { name: "admin: console", path: "/console", who: "admin" },
  { name: "support agent: console", path: "/console", who: "agent" },
];

const EMAIL: Record<Exclude<Who, "public">, string> = {
  ava: "ava@tasknest.test",
  tara: "tara@tasknest.test",
  pia: "pia@tasknest.test",
  admin: "admin@tasknest.test",
  agent: "agent@tasknest.test",
};

async function open(page: Page, c: RouteCase) {
  await mockBackend(page);
  if (c.who !== "public") {
    await signIn(page, EMAIL[c.who]);
    await expect(page.getByTestId("account-menu")).toBeVisible();
  }
  await page.goto(c.path);
  await expect(page.locator("#main h1").first()).toBeVisible();
  // Let data-loading pages finish (spinners and skeletons gone).
  await expect(page.getByText("Loading…")).toHaveCount(0);
}

for (const scheme of ["light", "dark"] as const) {
  test.describe(`axe, ${scheme} theme`, () => {
    test.use({ colorScheme: scheme });

    for (const c of ROUTES) {
      test(`${c.name} (${c.who} ${c.path})`, async ({ page }, info) => {
        const errors: string[] = [];
        page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
        page.on("console", (m) => {
          // The mock backend answers /quote with a deliberate 503 ("no server quote") so the page shows
          // its browser preview; the browser logs that failed fetch. Not an app error.
          if (m.type() === "error" && !m.location().url.includes("/quote"))
            errors.push(`console.error: ${m.text()}`);
        });

        await open(page, c);
        if (c.lands) await expect(page).toHaveURL(new RegExp(`${c.lands}$`));
        await expect(page.locator("html")).toHaveAttribute("data-theme", scheme);

        const results = await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
          .analyze();
        expect(
          results.violations.map((v) => ({
            id: v.id,
            impact: v.impact,
            nodes: v.nodes.slice(0, 3).map((n) => n.target.join(" ")),
          })),
          "axe violations",
        ).toEqual([]);

        // No horizontal scroll: the page is exactly as wide as the viewport.
        const widths = await page.evaluate(() => ({
          scroll: document.documentElement.scrollWidth,
          inner: window.innerWidth,
        }));
        expect(widths.scroll, `scrollWidth ${widths.scroll} vs viewport ${widths.inner}`).toBe(
          widths.inner,
        );
        if (info.project.name === "phone") expect(widths.inner).toBe(390);

        expect(errors, "console errors").toEqual([]);
      });
    }
  });
}
