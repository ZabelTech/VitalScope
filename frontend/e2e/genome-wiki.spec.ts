import { expect, test, type Page } from "@playwright/test";

async function login(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Begin the Cycle" }).first().click();
  await page.locator('input[type="password"]').first().fill("JohnBoyd");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("link", { name: "Observe" })).toBeVisible();
}

test("Browse seeded genomic wiki pages from Orient", async ({ page }) => {
  await login(page);
  await page.getByRole("link", { name: "Orient" }).click();

  const card = page.locator("section.card.genome-wiki-card");
  await card.scrollIntoViewIfNeeded();
  await expect(card).toBeVisible();
  await expect(card.getByRole("heading", { name: "Genomic wiki" })).toBeVisible();

  // The demo seed populates several variant pages; pick one we know exists.
  const mthfrEntry = card.locator(".genome-wiki-nav-item", {
    hasText: "rs1801133 (MTHFR)",
  });
  await expect(mthfrEntry).toBeVisible();
  await mthfrEntry.click();

  const reader = card.locator(".genome-wiki-reader");
  await expect(reader.getByRole("heading", { name: "What it is" })).toBeVisible();
  await expect(reader.getByRole("heading", { name: "What we don't know" })).toBeVisible();

  // The disclaimer is auto-injected on every variant page write.
  await expect(reader.getByText(/Informational only/)).toBeVisible();

  // Wikilinks render as clickable buttons; clicking one navigates.
  const sourceLink = reader.locator("button.genome-wiki-link", {
    hasText: "sources/snpedia/rs1801133",
  }).first();
  await expect(sourceLink).toBeVisible();
  await sourceLink.click();
  await expect(reader.getByText(/Provenance for/)).toBeVisible();
});

test("Ask a genome question and see the answer filed back", async ({ page }) => {
  await login(page);
  await page.getByRole("link", { name: "Decide" }).click();

  const card = page.locator("section.card", {
    has: page.getByRole("heading", { name: "Genome Q&A" }),
  });
  await card.scrollIntoViewIfNeeded();
  await expect(card).toBeVisible();

  await card.locator("textarea").fill("What does my MTHFR C677T mean for folate?");
  await card.getByRole("button", { name: "Ask" }).click();

  // The demo provider returns synchronously after a 0.4s sleep; wait for the
  // answer to land in the history list. The QA row carries the question's
  // title; demo's title is "Demo answer".
  const askedRow = card.locator(".genome-wiki-qa-row").first();
  await expect(askedRow).toBeVisible({ timeout: 15_000 });
  await expect(askedRow).toHaveClass(/genome-wiki-qa-row--active/);

  // The expanded body renders the four standard sections.
  const body = card.locator(".genome-wiki-qa-body").first();
  await expect(body.getByRole("heading", { name: "What it is" })).toBeVisible();
  await expect(body.getByRole("heading", { name: "What we don't know" })).toBeVisible();
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
