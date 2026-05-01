import { expect, test, type Page } from "@playwright/test";

const CATEGORIES = [
  { key: "heart_rate", label: "Heart rate", group: "Wearables" },
  { key: "hrv", label: "Heart rate variability", group: "Wearables" },
  { key: "sleep", label: "Sleep", group: "Wearables" },
  { key: "journal", label: "Journal entries", group: "Lifestyle" },
  { key: "bloodwork", label: "Bloodwork (as context)", group: "Health" },
];

async function login(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Begin the Cycle" }).first().click();
  await page.locator('input[type="password"]').first().fill("JohnBoyd");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("link", { name: "Observe" })).toBeVisible();
}

test("AI Context settings — opt out of a category and persist", async ({ page }) => {
  let state = CATEGORIES.map((c) => ({ ...c, enabled: true }));

  await page.route("**/api/settings/ai-context", async (route) => {
    if (route.request().method() === "PUT") {
      const body = route.request().postDataJSON() as { updates: Record<string, boolean> };
      state = state.map((c) =>
        c.key in body.updates ? { ...c, enabled: body.updates[c.key] } : c,
      );
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ categories: state }),
    });
  });

  await login(page);
  await page.getByLabel("Settings").click();

  const card = page.locator("section.ai-context-card");
  await expect(card.getByRole("heading", { name: "AI Context" })).toBeVisible();
  await card.getByRole("heading", { name: "AI Context" }).click();

  const journalCheckbox = card.getByRole("checkbox", { name: "Journal entries" });
  await expect(journalCheckbox).toBeChecked();

  await journalCheckbox.uncheck();
  await expect(journalCheckbox).not.toBeChecked();

  // Card should reflect the updated count from the mocked PUT response
  await expect(card.getByText(/of \d+ categories shared with AI/)).toBeVisible();
  expect(state.find((c) => c.key === "journal")?.enabled).toBe(false);

  await card.getByRole("button", { name: "Share everything" }).click();
  await expect(journalCheckbox).toBeChecked();
  expect(state.every((c) => c.enabled)).toBe(true);
});
