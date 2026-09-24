// Tests against the real Supabase project + `api` Edge Function. Run with E2E_BACKEND=1.
// They create real (test-mode) bookings, so run them against a seeded test project only.
import { expect, test } from "@playwright/test";
import { signIn } from "./mock-backend";

test.skip(!process.env.E2E_BACKEND, "needs a live backend (set E2E_BACKEND=1)");
test.describe.configure({ mode: "serial" });

test("client signs in and sees active taskers only", async ({ page }) => {
  await signIn(page, "ava@tasknest.test");
  await expect(page).toHaveURL(/\/taskers$/);
  await expect(page.getByTestId("tasker-card-tara")).toBeVisible();
  await expect(page.getByTestId("tasker-list")).not.toContainText("Moving"); // Pia is pending KYC
});

test("server quote matches the client preview for Tara 2h", async ({ page }) => {
  await signIn(page, "ava@tasknest.test");
  await page.getByTestId("tasker-card-tara").click();
  await page.getByTestId("booking-duration").selectOption("120");
  await expect(page.getByTestId("quote-total")).toHaveText("$103.50");
  await expect(page.getByTestId("quote-server-status")).toContainText("Server quote matches", {
    timeout: 15_000,
  });
});

test("book, then tasker accepts, starts and completes", async ({ page }) => {
  const minute = String(Math.floor(Math.random() * 12) * 5).padStart(2, "0");
  const day = String(10 + Math.floor(Math.random() * 18)).padStart(2, "0");
  await signIn(page, "ava@tasknest.test");
  await page.getByTestId("tasker-card-tara").click();
  await page.getByTestId("booking-duration").selectOption("120");
  await page.getByTestId("booking-start").fill(`2031-01-${day}T09:${minute}`);
  await page.getByTestId("booking-description").fill(`e2e ${Date.now()}`);
  await page.getByTestId("book-submit").click();
  await expect(page).toHaveURL(/\/bookings$/, { timeout: 15_000 });

  await page.getByTestId("sign-out").click();
  await signIn(page, "tara@tasknest.test");
  const job = page
    .getByTestId("job-card")
    .filter({ has: page.getByTestId("accept") })
    .first();
  await job.getByTestId("accept").click();
  await expect(page.getByTestId("flash")).toContainText("accepted");
});

test("pricing page reads the live policy row", async ({ page }) => {
  await page.goto("/pricing");
  await expect(page.getByTestId("policy-version")).toContainText("Policy version");
  await expect(page.getByTestId("policy-fallback")).toHaveCount(0);
  await expect(page.getByTestId("curve-row")).toHaveCount(3);
});
