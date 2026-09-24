// Tests against the real Supabase project + `api` Edge Function. Run with E2E_BACKEND=1 (and
// VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY set when the dev server starts). They create real
// (test-mode, fake payments provider) bookings, so run them against a seeded test project only.
import { expect, test } from "@playwright/test";
import { signIn } from "./mock-backend";

test.skip(!process.env.E2E_BACKEND, "needs a live backend (set E2E_BACKEND=1)");
test.describe.configure({ mode: "serial" });

/** A random future slot, spread widely so repeated runs don't collide with earlier test bookings. */
function randomSlot(): string {
  const pick = (n: number) => Math.floor(Math.random() * n);
  const pad = (n: number) => String(n).padStart(2, "0");
  const year = 2031 + pick(8);
  return `${year}-${pad(1 + pick(12))}-${pad(1 + pick(28))}T${pad(7 + pick(10))}:${pad(pick(12) * 5)}`;
}

test("client signs in and sees active taskers only, by their public names", async ({ page }) => {
  await signIn(page, "ava@tasknest.test");
  await expect(page).toHaveURL(/\/taskers$/);
  // The card id and the name come from taskers.display_name (profiles are private).
  await expect(page.getByTestId("tasker-card-tara")).toBeVisible();
  await expect(page.getByTestId("tasker-card-tara")).toContainText("Tara Tasker");
  await expect(page.getByTestId("tasker-list")).not.toContainText("Moving"); // Pia is pending KYC
});

test("server quote matches the client preview for Tara 2h", async ({ page }) => {
  await signIn(page, "ava@tasknest.test");
  await page.getByTestId("tasker-card-tara").click();
  await expect(page.getByTestId("tasker-name")).toHaveText("Tara Tasker");
  await page.getByTestId("booking-duration").selectOption("120");
  await expect(page.getByTestId("quote-total")).toHaveText("$103.50");
  await expect(page.getByTestId("quote-server-status")).toContainText("Server quote matches", {
    timeout: 15_000,
  });
});

test("book, then the tasker accepts, starts and completes", async ({ page }) => {
  const description = `e2e ${Date.now()}`;
  await signIn(page, "ava@tasknest.test");
  await page.getByTestId("tasker-card-tara").click();
  await page.getByTestId("booking-duration").selectOption("120");
  await page.getByTestId("booking-start").fill(randomSlot());
  await page.getByTestId("booking-description").fill(description);
  await page.getByTestId("book-submit").click();
  await expect(page).toHaveURL(/\/bookings$/, { timeout: 15_000 });
  const mine = page.getByTestId("booking-card").filter({ hasText: description });
  await expect(mine).toContainText("Tara Tasker"); // counterparty name via display_names

  await page.getByTestId("sign-out").click();
  await signIn(page, "tara@tasknest.test");
  const job = page.getByTestId("job-card").filter({ hasText: description });
  // A tasker sees only the client's first name.
  await expect(job).toContainText("Ava");
  await expect(job).not.toContainText("Ava Client");
  await job.getByTestId("accept").click();
  await expect(page.getByTestId("flash")).toContainText("accepted", { timeout: 15_000 });
  await page.getByTestId("job-card").filter({ hasText: description }).getByTestId("start").click();
  await expect(page.getByTestId("flash")).toContainText("started", { timeout: 15_000 });
  await page
    .getByTestId("job-card")
    .filter({ hasText: description })
    .getByTestId("complete-open")
    .click();
  await page.getByTestId("complete-confirm").click();
  await expect(page.getByTestId("flash")).toContainText("completed", { timeout: 15_000 });
});

test("pricing page reads the live policy row, not a future one", async ({ page }) => {
  await page.goto("/pricing");
  await expect(page.getByTestId("policy-version")).toContainText("Policy version");
  // The hosted project has a version published for 2099-12-31 (tests/api fixture): never active today.
  await expect(page.getByTestId("policy-version")).not.toContainText("2099");
  await expect(page.getByTestId("policy-fallback")).toHaveCount(0);
  await expect(page.getByTestId("curve-row")).toHaveCount(3);
});
