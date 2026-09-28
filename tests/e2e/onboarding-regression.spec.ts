import { expect, test } from "@playwright/test";

// Regression for the onboarding crash (an effect returned scrollIntoView's Promise).
// Creates a real account, so it runs only with E2E_SIGNUP=1.
test("onboarding and studio do not crash", async ({ page }) => {
  test.skip(!process.env.E2E_SIGNUP, "E2E_SIGNUP not set");
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(`${error.message}\n${error.stack ?? ""}`));
  const email = `repro-${Date.now()}@example.com`;
  await page.goto("/login");
  await page.getByRole("tab", { name: "Create account" }).click();
  await page.getByLabel("Your name").fill("Repro");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("Repro-pass-123");
  await page.getByRole("button", { name: "Create account" }).last().click();
  await page.waitForURL(/onboarding|\/$/, { timeout: 30_000 });
  await page.goto("/onboarding");
  await page.getByRole("button", { name: "Just joined" }).click();
  await page.waitForTimeout(1_500);
  await page.getByRole("button", { name: "Learn the basics" }).click();
  await page.getByRole("button", { name: "Brand new to it" }).click();
  await page.getByRole("button", { name: "15 minutes" }).click();
  await page.getByRole("button", { name: "English" }).click();
  await page.waitForURL((url) => url.pathname === "/", { timeout: 20_000 });
  await page.goto("/studio");
  await page.waitForTimeout(3_000);
  await page.getByRole("link", { name: "Journeys" }).click();
  await page.waitForTimeout(3_000);
  console.log(errors.join("\n---\n") || "NO PAGE ERRORS");
  expect(errors).toEqual([]);
});
