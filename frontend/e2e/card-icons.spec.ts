import { expect, test, type Page } from "@playwright/test";

async function login(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Begin the Cycle" }).first().click();
  await page.locator('input[type="password"]').first().fill("JohnBoyd");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("link", { name: "Observe" })).toBeVisible();
}

test("Card help popover opens with source/meaning content", async ({ page }) => {
  await login(page);
  await page.getByRole("link", { name: "Act", exact: true }).click();

  // Steps card on the Today dashboard
  const stepsCard = page
    .locator(".overview-card")
    .filter({ hasText: /^Steps/i })
    .first();
  await expect(stepsCard).toBeVisible();

  const helpBtn = stepsCard.getByRole("button", { name: "About this card" });
  await expect(helpBtn).toBeVisible();
  await helpBtn.click();

  const popover = page.getByRole("dialog", { name: /About Steps/i });
  await expect(popover).toBeVisible();
  await expect(popover.getByRole("heading", { name: "Source" })).toBeVisible();
  await expect(popover.getByRole("heading", { name: "What it means" })).toBeVisible();
  await expect(popover.getByText(/Garmin Connect/i)).toBeVisible();

  // ESC closes the popover.
  await page.keyboard.press("Escape");
  await expect(popover).not.toBeVisible();
});

test("Hiding a card persists across a full page reload", async ({ page }) => {
  // Drive the real flow against the live demo backend — no API mocks.
  // The bug this catches: if the PUT is rejected (e.g. demo-mode 403
  // or auth issue), the optimistic update gets reverted and the user
  // sees the card snap back. Even when the optimistic step "works",
  // the hide must survive a reload — that's the whole point of the
  // server-backed visibility table.
  await login(page);
  await page.getByRole("link", { name: "Act", exact: true }).click();

  const stepsCard = () =>
    page.locator(".overview-card").filter({ hasText: /^Steps/i }).first();
  await expect(stepsCard()).toBeVisible();

  // Wait for the PUT response so we know it succeeded before reloading.
  const putResponse = page.waitForResponse(
    (r) =>
      r.url().includes("/api/settings/card-visibility") &&
      r.request().method() === "PUT",
  );
  await stepsCard().getByRole("button", { name: "Hide card" }).click();
  const put = await putResponse;
  expect(put.ok(), `PUT should succeed, got ${put.status()}`).toBeTruthy();
  await expect(stepsCard()).toHaveCount(0);

  await page.reload();
  await expect(stepsCard()).toHaveCount(0);

  // Restore so subsequent runs aren't poisoned (DB persists across runs
  // when reuseExistingServer is true — see AGENTS.md e2e section).
  const reveal = page.locator(".cards-hidden-strip");
  await expect(reveal).toBeVisible();
  await reveal.getByRole("button", { name: "show" }).click();
  await expect(stepsCard()).toBeVisible();
});
