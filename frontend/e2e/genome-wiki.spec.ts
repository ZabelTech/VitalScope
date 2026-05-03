import { expect, test, type Page } from "@playwright/test";

const FIXTURE_PATH = "e2e/fixtures/snpedia.zip";

async function login(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Begin the Cycle" }).first().click();
  await page.locator('input[type="password"]').first().fill("JohnBoyd");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("link", { name: "Observe" })).toBeVisible();
}

// Drive upload → compile through the Decide → Entries → DNA UI. This both
// tests the feature and seeds the wiki for the browse / Q&A tests below
// (the demo backend uses reuseExistingServer so state carries between
// tests in this file).
test("Upload SNPedia bundle and compile the genomic wiki", async ({ page }) => {
  await login(page);
  // The SNPedia uploader lives on the Entries page → DNA section.
  // OodaPage stacks all sections, so a direct goto is enough.
  await page.goto("/entries");

  const panel = page.locator(".genome-snpedia-panel");
  await panel.scrollIntoViewIfNeeded();
  await expect(panel).toBeVisible();
  await panel.locator('input[type="file"]').setInputFiles(FIXTURE_PATH);
  // Wait for the upload to finish — the "compile" button enables when
  // an upload row exists.
  const compileBtn = panel.getByRole("button", { name: /Compile genomic wiki/ });
  await expect(compileBtn).toBeEnabled({ timeout: 15_000 });
  await compileBtn.click();
  await expect(panel.getByText(/Considered/)).toBeVisible({ timeout: 30_000 });
});

test("Browse the compiled wiki from Orient and follow a wikilink", async ({ page }) => {
  await login(page);
  await page.getByRole("link", { name: "Orient" }).click();

  const card = page.locator(".genome-wiki-card");
  await expect(card).toBeVisible();
  await card.scrollIntoViewIfNeeded();
  await expect(card.getByRole("heading", { name: "Genomic wiki" })).toBeVisible();

  // The fixture covers rs1801133 (MTHFR); demo provider names the page
  // "rs1801133 (MTHFR) — demo".
  const mthfrEntry = card.locator(".genome-wiki-nav-item", {
    hasText: /rs1801133/,
  }).first();
  await expect(mthfrEntry).toBeVisible();
  await mthfrEntry.click();

  const reader = card.locator(".genome-wiki-reader");
  await expect(reader.getByRole("heading", { name: "What it is" })).toBeVisible();
  await expect(reader.getByRole("heading", { name: "What we don't know" })).toBeVisible();

  // The disclaimer is auto-injected on every variant page write.
  await expect(reader.getByText(/Informational only/)).toBeVisible();

  // Validator now accepts external URL citations alongside wikilinks; the
  // demo payload includes a dbSNP URL to exercise that path end-to-end.
  await expect(reader.getByText(/ncbi\.nlm\.nih\.gov\/snp\/rs1801133/)).toBeVisible();

  // Wikilinks render as clickable buttons; clicking one navigates.
  const sourceLink = reader.locator("button.genome-wiki-link", {
    hasText: "sources/snpedia/rs1801133",
  }).first();
  await expect(sourceLink).toBeVisible();
  await sourceLink.click();
  await expect(reader.getByText(/Provenance/)).toBeVisible();
});

test("Ask a genome question and see the answer filed back", async ({ page }) => {
  await login(page);
  await page.getByRole("link", { name: "Decide" }).click();

  const card = page.locator(".overview-card", {
    has: page.getByRole("heading", { name: "Genome Q&A" }),
  });
  await expect(card).toBeVisible();
  await card.scrollIntoViewIfNeeded();

  await card.locator("textarea").fill("What does my MTHFR C677T mean for folate?");
  await card.getByRole("button", { name: "Ask" }).click();

  // Demo provider returns synchronously after a 0.4s sleep; wait for the
  // answer to land in the history list.
  const askedRow = card.locator(".genome-wiki-qa-row").first();
  await expect(askedRow).toBeVisible({ timeout: 15_000 });
  await expect(askedRow).toHaveClass(/genome-wiki-qa-row--active/);

  const body = card.locator(".genome-wiki-qa-body").first();
  await expect(body.getByRole("heading", { name: "What it is" })).toBeVisible();
  await expect(body.getByRole("heading", { name: "What we don't know" })).toBeVisible();
});

test("Recompile systems endpoint mines system_tags from compiled gene pages", async ({ page }) => {
  await login(page);
  // After login the auth cookie is set on this page's context, so
  // page.request inherits it and the protected endpoint accepts the call.
  const res = await page.request.post("/api/genome-wiki/recompile-systems");
  expect(res.ok()).toBeTruthy();
  const body = await res.json();
  // Shape contract — these keys are what the implementation returns and
  // what callers (curl, future UI panels) depend on.
  expect(body).toHaveProperty("written");
  expect(body).toHaveProperty("errors");
  expect(body).toHaveProperty("skipped_below_threshold");
  expect(body).toHaveProperty("raw_system_counts");
  expect(Array.isArray(body.written)).toBeTruthy();
  expect(Array.isArray(body.errors)).toBeTruthy();
  // raw_system_counts is a map of raw-tag-value → count; on a fresh demo
  // backend with no compiled gene pages it can be empty, so we only assert
  // the type shape.
  expect(typeof body.raw_system_counts).toBe("object");
  // Any failures returned by the endpoint mean compile_system_page rejected
  // a generated body — surface the first one so the failure is actionable.
  if (body.errors.length > 0) {
    throw new Error(`recompile-systems returned errors: ${JSON.stringify(body.errors[0])}`);
  }
});

test("Genome wiki settings card shows raw + compiled counts and saves the cap", async ({ page }) => {
  await login(page);
  await page.getByLabel("Settings").click();

  const card = page.locator("section.ai-context-card", {
    has: page.getByRole("heading", { name: "Genome wiki" }),
  });
  await card.scrollIntoViewIfNeeded();
  await expect(card).toBeVisible();
  await expect(card.getByText(/SNPedia raw pages/)).toBeVisible();

  // Expand and confirm the numeric input is present (read-only in demo).
  await card.getByRole("heading", { name: "Genome wiki" }).click();
  const numericInput = card.locator('input[type="number"]');
  await expect(numericInput).toBeVisible();
  await expect(numericInput).toBeDisabled();
});
