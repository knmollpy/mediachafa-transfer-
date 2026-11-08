import { test, expect } from "@playwright/test";

test("la página pública muestra el acceso principal de MediaChafa", async ({ page }) => {
  const uncaughtErrors = [];
  page.on("pageerror", error => uncaughtErrors.push(error.message));

  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page).toHaveTitle(/MediaChafa/i);
  await expect(page.locator("#login")).toBeVisible();
  await expect(page.locator("#login-form")).toBeVisible();
  await expect(page.locator("#username")).toBeVisible();
  await expect(page.locator("#password")).toBeVisible();
  await expect(page.getByRole("button", { name: /Entrar a la página/i })).toBeVisible();
  await expect(page.locator("#guest-ps4-entry")).toBeVisible();

  await page.waitForTimeout(1200);
  expect(uncaughtErrors, "No debería haber excepciones JavaScript sin controlar").toEqual([]);
});

test("el acceso sigue siendo usable en una pantalla móvil", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#login")).toBeVisible();
  await expect(page.locator("#username")).toBeVisible();

  const layout = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    content: document.documentElement.scrollWidth,
    card: document.querySelector(".login-card")?.getBoundingClientRect().width ?? 0
  }));
  expect(layout.card).toBeGreaterThan(0);
  expect(layout.content).toBeLessThanOrEqual(layout.viewport + 2);
});
