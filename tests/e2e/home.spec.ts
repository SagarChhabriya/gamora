import { expect, test } from "@playwright/test";

test("foundation page is reachable", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /give the work a way in/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /parse source/i })).toBeVisible();
});
