// The app shell: navigation per role at 1280 and 390, page titles and focus, toasts, 404, dark mode,
// dialogs, notifications. Runs in both Playwright projects (chromium = 1280, phone = 390).
import { expect, test, type Page } from "@playwright/test";
import { IDS, mockBackend, signIn } from "./mock-backend";

const isPhone = () => test.info().project.name === "phone";

async function as(page: Page, email: string) {
  const mock = await mockBackend(page);
  await signIn(page, email);
  await expect(page.getByTestId("account-menu")).toBeVisible();
  return mock;
}

test.describe("navigation per role", () => {
  test("signed out: public bar on desktop, drawer and sticky Book bar on phone", async ({
    page,
  }) => {
    await mockBackend(page);
    await page.goto("/signin");
    await expect(page.getByTestId("nav-signin")).toBeVisible();
    if (isPhone()) {
      await expect(page.getByTestId("sticky-book")).toBeVisible();
      await expect(page.getByTestId("main-nav")).toHaveCount(0);
      await page.getByTestId("open-menu").click();
      const drawer = page.getByTestId("drawer");
      await expect(drawer).toBeVisible();
      for (const id of ["nav-services", "nav-how", "nav-pricing", "nav-help", "nav-become"])
        await expect(drawer.getByTestId(id)).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(drawer).toBeHidden();
      await expect(page.getByTestId("open-menu")).toBeFocused();
    } else {
      for (const id of ["nav-services", "nav-how", "nav-pricing", "nav-help", "nav-become"])
        await expect(page.getByTestId("main-nav").getByTestId(id)).toBeVisible();
      await expect(page.getByTestId("nav-book")).toBeVisible();
    }
  });

  test("client: Book, Tasks, Messages, Rewards; one nav per breakpoint", async ({ page }) => {
    await as(page, "ava@tasknest.test");
    await expect(page).toHaveURL(/\/taskers$/);
    await expect(page.getByTestId("main-nav")).toHaveCount(1);
    for (const id of ["nav-taskers", "nav-bookings", "nav-messages", "nav-points"])
      await expect(page.getByTestId("main-nav").getByTestId(id)).toBeVisible();
    await expect(page.getByTestId("nav-console")).toHaveCount(0);
    await expect(page.getByTestId("nav-tasker")).toHaveCount(0);
    if (isPhone()) {
      await expect(page.getByTestId("main-nav").getByRole("link")).toHaveCount(5);
      await expect(page.getByTestId("nav-account")).toBeVisible();
      // Sign out lives in the account menu on phones.
      await page.getByTestId("account-menu").click();
      await expect(page.getByTestId("current-user")).toContainText("Ava Client");
      await page.getByTestId("sign-out").click();
    } else {
      await expect(page.getByTestId("current-user")).toContainText("Ava Client");
      await page.getByTestId("sign-out").click();
    }
    await expect(page).toHaveURL(/\/signin$/);
    await expect(page.getByTestId("nav-signin")).toBeVisible();
  });

  test("client: /points forwards to /rewards", async ({ page }) => {
    await as(page, "ava@tasknest.test");
    await page.goto("/points");
    await expect(page).toHaveURL(/\/rewards$/);
    await expect(page.getByTestId("nav-points")).toHaveAttribute("aria-current", "page");
  });

  test("tasker: Today, Jobs, Calendar, Earnings", async ({ page }) => {
    await as(page, "tara@tasknest.test");
    await expect(page).toHaveURL(/\/tasker$/);
    for (const id of ["nav-tasker", "nav-jobs", "nav-calendar", "nav-earnings"])
      await expect(page.getByTestId("main-nav").getByTestId(id)).toBeVisible();
    await expect(page.getByTestId("nav-bookings")).toHaveCount(0);
  });

  test("staff: console nav; admin-only sections for admins; provider badge", async ({ page }) => {
    await as(page, "admin@tasknest.test");
    await expect(page).toHaveURL(/\/console$/);
    await expect(page.getByTestId("provider-badge")).toHaveText("Payments: Simulated");
    if (isPhone()) {
      const select = page.getByTestId("console-section");
      await expect(select).toBeVisible();
      await expect(select.locator("option")).toContainText([/Queue/, /Payouts/, /Test tools/]);
    } else {
      for (const id of [
        "nav-console",
        "nav-console-payouts",
        "nav-console-policies",
        "nav-console-tools",
      ])
        await expect(page.getByTestId("main-nav").getByTestId(id)).toBeVisible();
    }
  });

  test("support agent: no admin sections; client sees no provider badge", async ({ page }) => {
    await as(page, "agent@tasknest.test");
    await expect(page.getByTestId("provider-badge")).toBeVisible();
    if (isPhone()) {
      await expect(page.getByTestId("console-section").locator("option")).not.toContainText([
        /Payouts/,
      ]);
    } else {
      await expect(page.getByTestId("nav-console-payouts")).toHaveCount(0);
      await expect(page.getByTestId("nav-console-bookings")).toBeVisible();
    }
  });

  test("a client does not see the provider badge", async ({ page }) => {
    await as(page, "ava@tasknest.test");
    await expect(page.getByTestId("provider-badge")).toHaveCount(0);
  });

  test("My tasks shows a Needs-action badge when a payment needs approval", async ({ page }) => {
    const mock = await mockBackend(page);
    mock.db.bookings.find((b) => b.id === IDS.b72)!.payment_state = "action_required";
    await signIn(page, "ava@tasknest.test");
    await expect(page.getByTestId("nav-bookings-badge")).toContainText("1");
    await expect(page.getByTestId("nav-bookings")).toContainText("need action");
  });
});

test.describe("titles, focus and announcements", () => {
  test("document.title is '<Page> · TaskNest' and focus moves to the h1 on navigation", async ({
    page,
  }) => {
    await as(page, "ava@tasknest.test");
    await page.getByTestId("nav-bookings").click();
    const h1 = page.locator("#main h1").first();
    await expect(h1).toBeFocused();
    const name = (await h1.textContent())!.trim();
    await expect(page).toHaveTitle(`${name} · TaskNest`);
    await expect(page.getByTestId("route-announcer")).toHaveText(name);

    await page.getByTestId("nav-points").click();
    await expect(page).toHaveURL(/\/rewards$/);
    await expect(page.locator("#main h1").first()).toBeFocused();
    await expect(page).toHaveTitle(/ · TaskNest$/);
  });

  test("the skip link is first in tab order and moves focus to the main content", async ({
    page,
  }) => {
    await mockBackend(page);
    await page.goto("/signin");
    await expect(page.locator("#main h1")).toBeVisible();
    await page.keyboard.press("Tab");
    await expect(page.getByTestId("skip-link")).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.locator("#main")).toBeFocused();
  });
});

test.describe("404 and planned pages", () => {
  test("an unknown path shows a 404 page, not a redirect", async ({ page }) => {
    await mockBackend(page);
    await page.goto("/definitely/not/here");
    await expect(page).toHaveURL(/\/definitely\/not\/here$/);
    await expect(page.getByTestId("not-found")).toBeVisible();
    await expect(page.locator("#main h1")).toHaveText("Page not found");
    await expect(page).toHaveTitle("Page not found · TaskNest");
  });

  test("a page that is planned but not built says 'Coming soon'", async ({ page }) => {
    await mockBackend(page);
    await page.goto("/help");
    await expect(page.getByTestId("coming-soon")).toBeVisible();
    await expect(page).toHaveTitle("Coming soon · TaskNest");
  });
});

test.describe("toasts", () => {
  test("a replayed response shows 'Already done earlier' in a flash toast", async ({ page }) => {
    await mockBackend(page);
    await signIn(page, "ava@tasknest.test");
    await page.route("**/functions/v1/api/quote**", (route) =>
      route.fulfill({
        status: 503,
        contentType: "application/json",
        headers: {
          "access-control-allow-origin": "*",
          "access-control-expose-headers": "idempotent-replayed",
          "idempotent-replayed": "true",
        },
        body: JSON.stringify({ error: { code: "unavailable", message: "replayed" } }),
      }),
    );
    await page.goto(`/taskers/${IDS.tara}`);
    const toast = page.getByTestId("flash").first();
    await expect(toast).toContainText("Already done earlier");
    await toast.getByRole("button", { name: "Dismiss" }).click();
    await expect(page.getByTestId("flash")).toHaveCount(0);
  });
});

test.describe("dark mode", () => {
  test("the account menu switches theme and remembers it", async ({ page }) => {
    await as(page, "ava@tasknest.test");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await page.getByTestId("account-menu").click();
    await page.getByTestId("theme-dark").check({ force: true });
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    expect(await page.evaluate(() => localStorage.getItem("tn-theme"))).toBe("dark");
    const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(bg).toBe("rgb(20, 18, 26)");
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await page.getByTestId("account-menu").click();
    await page.getByTestId("theme-system").check({ force: true });
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    expect(await page.evaluate(() => localStorage.getItem("tn-theme"))).toBeNull();
  });

  test.describe("follows the OS setting", () => {
    test.use({ colorScheme: "dark" });
    test("system theme is dark when the OS is dark", async ({ page }) => {
      await mockBackend(page);
      await page.goto("/signin");
      await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    });
  });
});

test.describe("dialogs", () => {
  test("trap focus, make the page behind inert, close on Esc and return focus", async ({
    page,
  }) => {
    await as(page, "ava@tasknest.test");
    await page.getByTestId("nav-bookings").click();
    const opener = page
      .locator(`[data-testid=booking-card][data-booking-id="${IDS.b72}"]`)
      .getByTestId("cancel-open");
    await opener.click();
    const dialog = page.getByTestId("cancel-dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute("aria-labelledby", /.+/);

    // Background is inert: it cannot be clicked.
    await expect(
      page.getByTestId("nav-bookings").click({ trial: true, timeout: 1000 }),
    ).rejects.toThrow();

    // Focus stays inside the dialog however often we Tab, forwards and back.
    for (let i = 0; i < 14; i++) {
      await page.keyboard.press(i < 9 ? "Tab" : "Shift+Tab");
      expect(await dialog.evaluate((d) => d.contains(document.activeElement))).toBe(true);
    }

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(opener).toBeFocused();
  });

  test("a backdrop click closes it too", async ({ page }) => {
    await as(page, "ava@tasknest.test");
    await page.getByTestId("nav-bookings").click();
    await page
      .locator(`[data-testid=booking-card][data-booking-id="${IDS.b72}"]`)
      .getByTestId("cancel-open")
      .click();
    const dialog = page.getByTestId("cancel-dialog");
    await expect(dialog).toBeVisible();
    await page.mouse.click(2, 2);
    await expect(dialog).toBeHidden();
  });
});

test.describe("notifications", () => {
  test("the bell counts unread notifications, lists them and marks them read", async ({ page }) => {
    await as(page, "ava@tasknest.test");
    await expect(page.getByTestId("notification-count")).toHaveText("1");
    await page.getByTestId("notification-bell").click();
    await expect(page.getByRole("region", { name: "Notifications" }).first()).toContainText(
      "Tara accepted your booking",
    );
    await page.getByRole("button", { name: "Mark all read" }).click();
    await expect(page.getByTestId("notification-count")).toHaveCount(0);
  });
});

test.describe("layout", () => {
  test("no horizontal scroll on the main pages", async ({ page }) => {
    await as(page, "ava@tasknest.test");
    for (const path of ["/taskers", "/bookings", "/rewards", "/pricing"]) {
      await page.goto(path);
      await expect(page.locator("#main h1").first()).toBeVisible();
      const w = await page.evaluate(() => ({
        s: document.documentElement.scrollWidth,
        i: window.innerWidth,
      }));
      expect(w.s, path).toBe(w.i);
    }
  });
});

test.describe("UI kit (the /design-system page)", () => {
  test.beforeEach(async ({ page }) => {
    await mockBackend(page);
    await page.goto("/design-system");
    await expect(page.locator("#main h1")).toHaveText("Design system");
  });

  test("toasts render the flash and refund-flash test ids", async ({ page }) => {
    await page.getByTestId("ds-toast").click();
    await expect(page.getByTestId("flash")).toContainText("Booking canceled");
    await page.getByTestId("ds-refund-toast").click();
    await expect(page.getByTestId("refund-flash")).toContainText("Refunded $70.00");
  });

  test("tabs are URL-synced and keyboard operable", async ({ page }) => {
    const tabs = page.getByRole("tablist", { name: "Example tabs" });
    await expect(tabs.getByRole("tab", { name: /Upcoming/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await tabs.getByRole("tab", { name: /Past/ }).click();
    await expect(page).toHaveURL(/tab=past/);
    await page.keyboard.press("ArrowRight");
    await expect(page).toHaveURL(/tab=cancelled/);
    await expect(tabs.getByRole("tab", { name: "Cancelled" })).toBeFocused();
    await page.reload();
    await expect(tabs.getByRole("tab", { name: "Cancelled" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  test("a sheet traps focus, closes on Esc and returns focus", async ({ page }) => {
    const opener = page.getByTestId("ds-open-sheet");
    await opener.click();
    const sheet = page.getByTestId("ds-sheet");
    await expect(sheet).toBeVisible();
    await page.keyboard.press("Tab");
    expect(await sheet.evaluate((d) => d.contains(document.activeElement))).toBe(true);
    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();
    await expect(opener).toBeFocused();
  });

  test("the hold chip explains 'Hold, not a charge'", async ({ page }) => {
    const chip = page.locator('[data-hold-state="hold_active"]');
    await expect(chip).toContainText(/Hold \$83\.50 · releases by/);
    await chip.click();
    await expect(page.getByRole("note")).toContainText("Hold, not a charge");
  });

  test("the combobox filters as you type and selects with the keyboard", async ({ page }) => {
    const box = page.getByRole("combobox", { name: "Category" });
    await box.fill("mov");
    await expect(page.getByRole("option")).toHaveCount(1);
    await box.press("Enter");
    await expect(box).toHaveValue("Moving");
  });

  test("the table stays a <table> and turns rows into cards on phones", async ({ page }) => {
    await expect(page.locator("table tr[data-booking-id]")).toHaveCount(2);
    const cell = page.locator("tr[data-booking-id] td").first();
    await expect(cell).toHaveAttribute("data-label", "Tasker");
    const display = await page
      .locator("tr[data-booking-id]")
      .first()
      .evaluate((el) => getComputedStyle(el).display);
    expect(display).toBe(isPhone() ? "block" : "table-row");
  });

  test("money carries its machine-readable attributes", async ({ page }) => {
    const total = page.locator('[data-money-kind="total"][data-policy-version="2"]');
    await expect(total).toHaveAttribute("data-money-cents", "10350");
    await expect(total).toHaveText("$103.50");
    await expect(page.locator('[data-source="browser"]')).toHaveText("$103.50");
    await expect(page.locator('[data-money-sign="minus"]').first()).toBeVisible();
  });

  test("the chip gallery shows every glossary state with its text", async ({ page }) => {
    const gallery = page.getByTestId("chip-gallery");
    for (const t of [
      "Finishing payment",
      "Payment needs your approval",
      "Refund pending at bank",
      "Sent to payout account",
      "In your bank",
    ])
      await expect(gallery).toContainText(t);
  });
});
