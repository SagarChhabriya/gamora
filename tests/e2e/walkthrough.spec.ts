import { expect, test, type Page } from "@playwright/test";

// Signed-in walkthrough with screenshots. Needs the seeded panel accounts:
// E2E_LEARNER_PASSWORD=... E2E_ADMIN_PASSWORD=... pnpm test:e2e
const learnerPassword = process.env.E2E_LEARNER_PASSWORD;
const adminPassword = process.env.E2E_ADMIN_PASSWORD;
const shots = process.env.E2E_SCREENSHOT_DIR ?? "test-results/screens";

async function signIn(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: /^sign in$/i }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 20_000 });
}

test.describe("learner walkthrough", () => {
  test.skip(!learnerPassword, "E2E_LEARNER_PASSWORD not set");
  test.setTimeout(180_000);

  test("journey map, mission, adaptation controls", async ({ page }) => {
    await signIn(page, "panel-learner@gamora.demo", learnerPassword as string);
    await expect(page.getByRole("heading", { name: /pick up where you left off/i })).toBeVisible({ timeout: 20_000 });
    await page.screenshot({ path: `${shots}/01-home.png`, fullPage: true });
    await page.getByRole("link", { name: /missions/i }).first().click();
    await expect(page.getByRole("heading", { name: /what you have shown so far/i })).toBeVisible({ timeout: 20_000 });
    await page.screenshot({ path: `${shots}/02-journey-map.png`, fullPage: true });
    await page.getByRole("link", { name: /mission 1/i }).click();
    await expect(page.locator("article").first()).toBeVisible({ timeout: 60_000 });
    await page.screenshot({ path: `${shots}/03-mission.png`, fullPage: true });
    await page.getByRole("button", { name: "Roman Urdu" }).click();
    await expect(page.getByText(/why this changed/i).first()).toBeVisible({ timeout: 60_000 });
    await page.screenshot({ path: `${shots}/04-roman-urdu.png`, fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: `${shots}/05-mission-mobile.png`, fullPage: true });
  });
});

test.describe("admin walkthrough", () => {
  test.skip(!adminPassword, "E2E_ADMIN_PASSWORD not set");
  test.setTimeout(120_000);

  test("dashboard, config, report", async ({ page }) => {
    await signIn(page, "panel-admin@gamora.demo", adminPassword as string);
    await page.goto("/admin");
    await expect(page.getByRole("heading", { name: /mastery heatmap/i })).toBeVisible({ timeout: 30_000 });
    await page.screenshot({ path: `${shots}/10-admin-dashboard.png`, fullPage: true });
    await page.goto("/admin/config");
    await expect(page.getByRole("heading", { name: /change how gamora teaches/i })).toBeVisible({ timeout: 20_000 });
    await page.screenshot({ path: `${shots}/11-admin-config.png`, fullPage: true });
    await page.goto("/admin/report");
    await expect(page.getByRole("heading", { name: /did people learn/i })).toBeVisible({ timeout: 30_000 });
    await page.screenshot({ path: `${shots}/12-report.png`, fullPage: true });
  });
});
