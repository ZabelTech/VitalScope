import { expect, test, type Page } from "@playwright/test";

async function login(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Begin the Cycle" }).first().click();
  await page.locator('input[type="password"]').first().fill("JohnBoyd");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("link", { name: "Observe" })).toBeVisible();
}

test("AI Context settings card renders categories and is read-only in demo mode", async ({ page }) => {
  await login(page);
  await page.getByLabel("Settings").click();

  const card = page.locator("section.ai-context-card");
  await expect(card).toBeVisible();
  await expect(card.getByRole("heading", { name: "AI Context" })).toBeVisible();
  await expect(card.getByText(/categories shared with AI/)).toBeVisible();

  await card.getByRole("heading", { name: "AI Context" }).click();

  // Categories come from the live demo backend; assert a representative
  // checkbox per group is rendered and that controls are read-only (demo mode).
  const journalCheckbox = card.getByRole("checkbox", { name: "Journal entries" });
  const hrvCheckbox = card.getByRole("checkbox", { name: "Heart rate variability" });
  const bloodworkCheckbox = card.getByRole("checkbox", { name: "Bloodwork (as context)" });

  await expect(journalCheckbox).toBeVisible();
  await expect(hrvCheckbox).toBeVisible();
  await expect(bloodworkCheckbox).toBeVisible();

  await expect(journalCheckbox).toBeDisabled();
  await expect(card.getByRole("button", { name: "Share everything" })).toBeDisabled();
  await expect(card.getByRole("button", { name: "Share nothing" })).toBeDisabled();
});
