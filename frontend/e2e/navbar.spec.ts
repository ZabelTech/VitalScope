import { expect, test, type Page } from "@playwright/test";

async function login(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Begin the Cycle" }).first().click();
  await page.locator('input[type="password"]').first().fill("JohnBoyd");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("link", { name: "Observe" })).toBeVisible();
}

test("Reload icon in navbar reloads the page", async ({ page }) => {
  await login(page);

  const reloadBtn = page.getByRole("button", { name: "Reload" });
  await expect(reloadBtn).toBeVisible();

  await page.evaluate(() => {
    (window as unknown as { __beforeReload?: boolean }).__beforeReload = true;
  });

  await Promise.all([page.waitForEvent("load"), reloadBtn.click()]);

  const flagAfter = await page.evaluate(
    () => (window as unknown as { __beforeReload?: boolean }).__beforeReload,
  );
  expect(flagAfter).toBeUndefined();
  await expect(page.getByRole("link", { name: "Observe" })).toBeVisible();
});
