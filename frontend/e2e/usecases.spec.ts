import { expect, test, type Locator, type Page } from "@playwright/test";

async function login(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Begin the Cycle" }).first().click();
  await page.locator('input[type="password"]').first().fill("JohnBoyd");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("link", { name: "Observe" })).toBeVisible();
}

function pluginCard(page: Page, title: RegExp): Locator {
  return page.locator("section.card", {
    has: page.getByRole("heading", { name: title }),
  });
}

test("Full ReSync Garmin", async ({ page }) => {
  await login(page);
  await page.getByLabel("Settings").click();

  const garmin = pluginCard(page, /Garmin Connect/i);
  await garmin.getByRole("heading", { name: /Garmin Connect/i }).click();
  await garmin.getByRole("button", { name: "Full resync" }).click();

  await expect(garmin.getByRole("button", { name: "Running…" }).first()).toBeVisible();
});

test("Pull latest Strong workouts", async ({ page }) => {
  await login(page);
  await page.getByLabel("Settings").click();

  const strong = pluginCard(page, /Strong/i);
  await strong.getByRole("heading", { name: /Strong/i }).click();
  await strong.getByRole("button", { name: "Run now" }).click();

  await expect(strong.getByRole("button", { name: "Running…" }).first()).toBeVisible();
});

test("Run daily OODA loop", async ({ page }) => {
  await login(page);

  await page.getByRole("link", { name: "Observe" }).click();
  await expect(page.getByRole("heading", { name: "Today's metrics" })).toBeVisible();

  await page.getByRole("link", { name: "Orient" }).click();
  await expect(page.getByRole("heading", { name: "AI Analysis" })).toBeVisible();

  await page.getByRole("link", { name: "Decide" }).click();
  await expect(page.getByRole("heading", { name: "Plan" })).toBeVisible();

  await page.getByRole("link", { name: "Act" }).click();
  await expect(page.getByRole("heading", { name: "Meals & water" })).toBeVisible();
});

test("Log meal and review postprandial response", async ({ page }) => {
  await page.route("**/api/glucose/postprandial**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([
        { date: "2026-04-26", timestamp: "2026-04-26T08:00:00Z", mgdl: 94, trend: 2, source: "test" },
        { date: "2026-04-26", timestamp: "2026-04-26T08:30:00Z", mgdl: 118, trend: 4, source: "test" },
      ]),
    });
  });

  await login(page);
  await page.getByRole("link", { name: "Act" }).click();

  await page.getByPlaceholder("Name (e.g. Breakfast)").fill("E2E Oatmeal");
  await page.locator('input[type="time"]').first().fill("08:00");
  await page.getByRole("button", { name: "Add meal" }).click();

  await expect(page.getByText("E2E Oatmeal")).toBeVisible();
  await expect(page.getByText("2-hour glucose response")).toBeVisible();
});

test("Set plugin credentials and automation schedule", async ({ page }) => {
  await login(page);
  await page.getByLabel("Settings").click();

  const garmin = pluginCard(page, /Garmin Connect/i);
  await garmin.getByRole("heading", { name: /Garmin Connect/i }).click();

  await garmin.locator('input[type="number"]').first().fill("90");
  await garmin.locator('input[type="text"]').first().fill("qa@example.com");
  await garmin.locator('input[type="password"]').first().fill("masked-secret");
  await garmin.getByRole("button", { name: "Save" }).click();

  await expect(garmin.getByText("Saved")).toBeVisible();
});
