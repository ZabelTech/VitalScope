import { expect, test, type Page } from "@playwright/test";

async function login(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Begin the Cycle" }).first().click();
  await page.locator('input[type="password"]').first().fill("JohnBoyd");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("link", { name: "Observe" })).toBeVisible();
}

// The demo backend short-circuits the subprocess path and replays a
// scripted timeline (`_DEMO_INGEST_SCRIPT` in backend/app.py) so we can
// observe the same UI states a real ingest would produce, without
// burning any AI credits or needing an actual VCF.
test("Genome wiki ingest job: progress modal cycles through stages and lands a summary", async ({
  page,
}) => {
  await login(page);
  await page.goto("/entries");

  // Kick off a job directly via the API — exercises the same path the UI
  // would take after a VCF upload, and avoids depending on file-input
  // wiring in this spec.
  const startRes = await page.request.post("/api/genome-wiki/ingest-jobs", {
    data: {},
  });
  expect(startRes.ok()).toBeTruthy();
  const startBody = await startRes.json();
  expect(startBody).toHaveProperty("job_id");

  // The Decide → DNA card should now show the resume CTA instead of the
  // upload picker.
  const resumeBtn = page.getByTestId("genome-ingest-resume");
  await expect(resumeBtn).toBeVisible({ timeout: 10_000 });
  await resumeBtn.click();

  // Modal opens and renders the canonical stage list.
  const stageList = page.getByTestId("ingest-stage-list");
  await expect(stageList).toBeVisible();

  // Wait for the AI-compile stage to enter the running state at least
  // once during the scripted timeline — variants is the most prominent
  // user-visible stage.
  const variantsRow = stageList.locator('[data-stage="variants"]');
  await expect(variantsRow).toHaveClass(
    /ingest-stage-(running|done)/,
    { timeout: 30_000 },
  );

  // Final summary lands when the demo timeline finishes.
  await expect(page.getByTestId("ingest-summary")).toBeVisible({
    timeout: 60_000,
  });
});
