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
  await page.getByRole("link", { name: "Act" }).click();

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

test("Hide icon optimistically removes the card and reveal strip restores it", async ({ page }) => {
  // Stub the PUT so demo mode's 403 doesn't trigger the optimistic revert.
  let hidden: string[] = [];
  await page.route("**/api/settings/card-visibility", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ hidden }),
      });
      return;
    }
    if (route.request().method() === "PUT") {
      const body = JSON.parse(route.request().postData() || "{}") as {
        card_id: string;
        hidden: boolean;
      };
      if (body.hidden) {
        if (!hidden.includes(body.card_id)) hidden.push(body.card_id);
      } else {
        hidden = hidden.filter((id) => id !== body.card_id);
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ hidden }),
      });
      return;
    }
    await route.continue();
  });

  await login(page);
  await page.getByRole("link", { name: "Act" }).click();

  const stepsCard = page
    .locator(".overview-card")
    .filter({ hasText: /^Steps/i })
    .first();
  await expect(stepsCard).toBeVisible();

  await stepsCard.getByRole("button", { name: "Hide card" }).click();
  await expect(stepsCard).not.toBeVisible();

  const reveal = page.locator(".cards-hidden-strip");
  await expect(reveal).toBeVisible();
  await expect(reveal).toContainText(/1 card hidden/i);

  await reveal.getByRole("button", { name: "show" }).click();
  await expect(reveal).not.toBeVisible();
  await expect(
    page.locator(".overview-card").filter({ hasText: /^Steps/i }).first(),
  ).toBeVisible();
});
