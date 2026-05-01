import { expect, test, type Page } from "@playwright/test";

async function login(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Begin the Cycle" }).first().click();
  await page.locator('input[type="password"]').first().fill("JohnBoyd");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("link", { name: "Observe" })).toBeVisible();
}

test("AI Context settings — opt out of a category and round-trip via mocked API", async ({ page }) => {
  type Cat = { key: string; label: string; group: string; enabled: boolean };
  let state: Cat[] = [
    { key: "heart_rate", label: "Heart rate", group: "Wearables", enabled: true },
    { key: "hrv", label: "Heart rate variability", group: "Wearables", enabled: true },
    { key: "sleep", label: "Sleep", group: "Wearables", enabled: true },
    { key: "journal", label: "Journal entries", group: "Lifestyle", enabled: true },
    { key: "bloodwork", label: "Bloodwork (as context)", group: "Health", enabled: true },
  ];

  await page.route("**/api/settings/ai-context", async (route) => {
    if (route.request().method() === "PUT") {
      const body = (route.request().postDataJSON() ?? {}) as {
        updates?: Record<string, boolean>;
      };
      const updates = body.updates ?? {};
      state = state.map((c) =>
        Object.prototype.hasOwnProperty.call(updates, c.key)
          ? { ...c, enabled: updates[c.key] }
          : c,
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
  await expect(card).toBeVisible();
  await expect(card.getByRole("heading", { name: "AI Context" })).toBeVisible();
  // Wait until the category count copy reflects the loaded state (loading -> N of M).
  await expect(card.getByText(/categories shared with AI/)).toBeVisible();

  await card.getByRole("heading", { name: "AI Context" }).click();

  const journalCheckbox = card.getByRole("checkbox", { name: "Journal entries" });
  await expect(journalCheckbox).toBeChecked();

  await journalCheckbox.uncheck();
  await expect(journalCheckbox).not.toBeChecked();
  await expect(card.getByText("4 of 5 categories shared with AI")).toBeVisible();
  expect(state.find((c) => c.key === "journal")?.enabled).toBe(false);
});
