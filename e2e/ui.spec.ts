// UI tests against a mocked Supabase + api (no live backend needed).
import { expect, test } from "@playwright/test";
import { IDS, mockBackend, signIn } from "./mock-backend";

test.describe("sign in", () => {
  test("shows demo accounts and signs a client in", async ({ page }) => {
    await mockBackend(page);
    await page.goto("/signin");
    await expect(page.getByTestId("demo-accounts")).toContainText("tara@tasknest.test");
    await expect(page.getByTestId("demo-accounts")).toContainText("TaskNest!2026");
    await page.getByTestId("demo-ava").click();
    await expect(page.getByTestId("signin-email")).toHaveValue("ava@tasknest.test");
    await page.getByTestId("signin-submit").click();
    await expect(page).toHaveURL(/\/taskers$/);
    await expect(page.getByTestId("current-user")).toContainText("Ava Client");
    await expect(page.getByTestId("nav-bookings")).toBeVisible();
    await expect(page.getByTestId("nav-console")).toHaveCount(0);
  });

  test("rejects a wrong password", async ({ page }) => {
    await mockBackend(page);
    await page.goto("/signin");
    await page.getByTestId("signin-email").fill("ava@tasknest.test");
    await page.getByTestId("signin-password").fill("nope");
    await page.getByTestId("signin-submit").click();
    await expect(page.getByTestId("signin-error")).toBeVisible();
  });

  test("role-based nav: tasker and admin land on their pages", async ({ page }) => {
    await mockBackend(page);
    await signIn(page, "tara@tasknest.test");
    await expect(page).toHaveURL(/\/tasker$/);
    await expect(page.getByTestId("nav-tasker")).toBeVisible();
    await page.getByTestId("sign-out").click();
    await signIn(page, "admin@tasknest.test");
    await expect(page).toHaveURL(/\/console$/);
    await expect(page.getByTestId("nav-console")).toBeVisible();
  });
});

test.describe("booking", () => {
  test("quote for Tara 2h: $90 subtotal, $13.50 fee, $103.50 total", async ({ page }) => {
    await mockBackend(page);
    await signIn(page, "ava@tasknest.test");
    await page.getByTestId("tasker-card-tara").click();
    await expect(page.getByTestId("tasker-name")).toHaveText("Tara Tasker");
    await page.getByTestId("booking-duration").selectOption("120");
    await expect(page.getByTestId("quote-subtotal")).toHaveText("$90.00");
    await expect(page.getByTestId("quote-service-fee")).toHaveText("$13.50");
    await expect(page.getByTestId("quote-tax")).toHaveText("$0.00");
    await expect(page.getByTestId("quote-total")).toHaveText("$103.50");
    await expect(page.getByTestId("quote-card")).toHaveText("$103.50");
    // 3h changes the numbers
    await page.getByTestId("booking-duration").selectOption("180");
    await expect(page.getByTestId("quote-total")).toHaveText("$155.25");
  });

  test("book with points + card split sends the right request", async ({ page }) => {
    const mock = await mockBackend(page);
    await signIn(page, "ava@tasknest.test");
    await page.goto(`/taskers/${IDS.tara}`);
    await page.getByTestId("booking-duration").selectOption("120");
    await expect(page.getByTestId("points-available")).toHaveText("1,700");
    await page.getByTestId("points-toggle").check();
    await page.getByTestId("points-input").fill("300");
    await expect(page.getByTestId("points-error")).toContainText("minimum redemption is 500");
    await page.getByTestId("points-input").fill("1000");
    await expect(page.getByTestId("quote-points")).toHaveText("$10.00");
    await expect(page.getByTestId("quote-card")).toHaveText("$93.50");
    await expect(page.getByTestId("quote-total")).toHaveText("$103.50");
    await page.getByTestId("booking-description").fill("Mount a TV");
    await page.getByTestId("booking-start").fill("2030-03-10T10:00");
    await page.getByTestId("book-submit").click();
    await expect(page).toHaveURL(/\/bookings$/);
    const call = mock.apiCalls.find((c) => c.path === "/bookings");
    expect(call?.body).toMatchObject({ taskerId: IDS.tara, minutes: 120, pointsRequested: 1000, localStart: "2030-03-10T10:00", tz: "America/Los_Angeles", description: "Mount a TV" });
    expect(call?.headers["idempotency-key"]).toBeTruthy();
    expect(call?.headers["authorization"]).toMatch(/^Bearer /);
  });

  test("promo code preview applies as promo credit", async ({ page }) => {
    await mockBackend(page);
    await signIn(page, "ava@tasknest.test");
    await page.goto(`/taskers/${IDS.tara}`);
    await page.getByTestId("booking-duration").selectOption("120");
    await page.getByTestId("promo-input").fill("WELCOME10");
    await expect(page.getByTestId("quote-promo")).toHaveText("$10.00");
    await expect(page.getByTestId("quote-card")).toHaveText("$93.50");
    // FIRST20 is first-task only and Ava already has bookings
    await page.getByTestId("promo-input").fill("FIRST20");
    await expect(page.getByTestId("promo-error")).toContainText("first tasks only");
  });
});

test.describe("cancellation preview", () => {
  const card = (page: import("@playwright/test").Page, id: string) => page.locator(`[data-testid=booking-card][data-booking-id="${id}"]`);

  test("≥48h: full refund", async ({ page }) => {
    await mockBackend(page);
    await signIn(page, "ava@tasknest.test");
    await page.getByTestId("nav-bookings").click();
    await card(page, IDS.b72).getByTestId("cancel-open").click();
    await expect(page.getByTestId("cancel-refund-total")).toHaveText("$103.50");
    await expect(page.getByTestId("cancel-fee")).toHaveText("$0.00");
    await expect(page.getByTestId("cancel-tier")).toContainText("100% refunded");
  });

  test("24–48h: 50% refund", async ({ page }) => {
    await mockBackend(page);
    await signIn(page, "ava@tasknest.test");
    await page.getByTestId("nav-bookings").click();
    await card(page, IDS.b36).getByTestId("cancel-open").click();
    await expect(page.getByTestId("cancel-refund-total")).toHaveText("$51.75");
    await expect(page.getByTestId("cancel-fee")).toHaveText("−$51.75");
  });

  test("<24h with points+card: 1h of rate kept from card, points returned", async ({ page }) => {
    const mock = await mockBackend(page);
    await signIn(page, "ava@tasknest.test");
    await page.getByTestId("nav-bookings").click();
    await card(page, IDS.b2).getByTestId("cancel-open").click();
    await expect(page.getByTestId("cancel-fee")).toHaveText("−$45.00");
    await expect(page.getByTestId("cancel-refund-total")).toHaveText("$58.50");
    await expect(page.getByTestId("cancel-refund-card")).toHaveText("$8.50");
    await expect(page.getByTestId("cancel-refund-points")).toHaveText("$50.00");
    await page.getByTestId("cancel-confirm").click();
    await expect(page.getByTestId("flash")).toContainText("$58.50");
    expect(mock.apiCalls.find((c) => c.path === `/bookings/${IDS.b2}/cancel`)).toBeTruthy();
  });
});

test.describe("tips", () => {
  test("tip above 25% of subtotal is blocked with a clear message", async ({ page }) => {
    const mock = await mockBackend(page);
    await signIn(page, "ava@tasknest.test");
    await page.getByTestId("nav-bookings").click();
    await page.locator(`[data-testid=booking-card][data-booking-id="${IDS.bDone}"]`).getByTestId("tip-open").click();
    await page.getByTestId("tip-input").fill("30");
    await expect(page.getByTestId("tip-error")).toHaveText("Tip can't be more than $22.50 (25% of the $90.00 task subtotal)");
    await expect(page.getByTestId("tip-confirm")).toBeDisabled();
    await page.getByTestId("tip-input").fill("22.50");
    await expect(page.getByTestId("tip-error")).toHaveCount(0);
    await page.getByTestId("tip-confirm").click();
    await expect(page.getByTestId("flash")).toContainText("$22.50");
    expect(mock.apiCalls.find((c) => c.path.endsWith("/tip"))?.body).toEqual({ amountCents: 2250 });
  });
});

test.describe("tasker", () => {
  test("accept a request and complete a job with extras", async ({ page }) => {
    const mock = await mockBackend(page);
    await signIn(page, "tara@tasknest.test");
    await expect(page.getByTestId("tasker-balance")).toHaveText("$76.50");
    const req = page.locator(`[data-testid=job-card][data-booking-id="${IDS.bReq}"]`);
    await req.getByTestId("accept").click();
    await expect(page.getByTestId("flash")).toContainText("accepted");
    const acceptCall = mock.apiCalls.find((c) => c.path === `/bookings/${IDS.bReq}/accept`);
    expect(acceptCall?.headers["idempotency-key"]).toBeTruthy();

    await page.locator(`[data-testid=job-card][data-booking-id="${IDS.bProg}"]`).getByTestId("complete-open").click();
    await page.getByTestId("complete-extra-minutes").fill("30");
    await page.getByTestId("complete-expenses").fill("12.50");
    await expect(page.getByTestId("complete-extra-labor")).toHaveText("$22.50");
    await expect(page.getByTestId("complete-expense-amount")).toHaveText("$12.50");
    await page.getByTestId("complete-confirm").click();
    await expect(page.getByTestId("flash")).toContainText("completed");
    expect(mock.apiCalls.find((c) => c.path === `/bookings/${IDS.bProg}/complete`)?.body).toEqual({ extraMinutes: 30, expensesCents: 1250 });
  });

  test("pending tasker sees a status banner", async ({ page }) => {
    await mockBackend(page);
    await signIn(page, "pia@tasknest.test");
    await expect(page.getByTestId("tasker-status-banner")).toContainText("pending verification");
  });
});

test.describe("pricing page (published terms)", () => {
  test("renders fees and the cancellation curve from the policy row", async ({ page }) => {
    await mockBackend(page);
    await page.goto("/pricing");
    await expect(page.getByTestId("policy-version")).toContainText("Policy version 1");
    await expect(page.getByTestId("fee-client")).toContainText("15%");
    await expect(page.getByTestId("example-total")).toHaveText("$103.50");
    const rows = page.getByTestId("curve-row");
    await expect(rows).toHaveCount(3);
    await expect(rows.nth(0)).toContainText("48 hours or more");
    await expect(rows.nth(0).getByTestId("curve-refund")).toHaveText("$103.50");
    await expect(rows.nth(1)).toContainText("24 to 48 hours");
    await expect(rows.nth(1).getByTestId("curve-refund")).toHaveText("$51.75");
    await expect(rows.nth(2)).toContainText("60 minutes");
    await expect(rows.nth(2).getByTestId("curve-fee")).toHaveText("$45.00");
    await expect(page.getByTestId("tips-cap")).toContainText("25%");
    await expect(page.getByTestId("tips-share")).toHaveText("100%");
    await expect(page.getByTestId("points-min")).toContainText("500");
    await expect(page.getByTestId("refund-order")).toHaveText("Card → Wallet → Points → Promo credit");
  });
});

test.describe("console", () => {
  test("support agent refund above the limit requires an approver", async ({ page }) => {
    await mockBackend(page);
    await signIn(page, "agent@tasknest.test");
    await page.locator(`[data-testid=console-booking-row][data-booking-id="${IDS.bDone}"]`).click();
    await page.getByTestId("console-refund-amount").fill("103.50");
    await page.getByTestId("console-refund-reason").fill("Job not done");
    await expect(page.getByTestId("console-refund-error")).toContainText("needs approval");
    await expect(page.getByTestId("console-refund-submit")).toBeDisabled();
    await page.getByTestId("console-refund-approver").selectOption(IDS.admin);
    await expect(page.getByTestId("console-refund-preview")).toContainText("$103.50");
    await expect(page.getByTestId("console-refund-submit")).toBeEnabled();
  });
});
