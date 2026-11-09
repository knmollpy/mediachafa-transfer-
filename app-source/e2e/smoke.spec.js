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


test("Beta coloca el modo y el equipo dentro de Ajustes, fuera del compositor", async ({ page }) => {
  const pageErrors = [];
  page.on("pageerror", error => pageErrors.push(error.message));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/", { waitUntil: "domcontentloaded" });

  // Simulate an authenticated owner opening Beta without depending on Supabase credentials.
  await page.evaluate(() => {
    document.querySelector("#login")?.classList.add("hidden");
    document.querySelector("#app")?.classList.remove("hidden");
    document.querySelector("#app")?.classList.add("beta-mode");
    document.querySelector("#beta-tab")?.classList.remove("hidden");
  });
  await page.locator("#beta-tab").click();
  await page.waitForSelector("#beta-panel .beta-sidebar", { state: "attached" });
  const debug = await page.evaluate(() => {
    const gear = document.querySelector("#beta-settings-toggle");
    const panel = document.querySelector("#beta-settings");
    const sidebar = document.querySelector("#beta-panel .beta-sidebar");
    return {
      gearExists: Boolean(gear),
      gearParent: gear?.parentElement?.className || null,
      settingsExists: Boolean(panel),
      settingsParent: panel?.parentElement?.className || null,
      sidebarExists: Boolean(sidebar),
      betaScript: [...document.scripts].find(script => script.src.includes("/beta.js"))?.src || null
    };
  });
  console.log("BETA_SETTINGS_DEBUG", JSON.stringify(debug));

  const gear = page.locator("#beta-panel .beta-sidebar #beta-settings-toggle");
  const settings = page.locator("#beta-panel #beta-settings");
  await expect(gear).toBeAttached();
  await expect(gear).toBeVisible();
  await expect(page.locator("#beta-form .beta-mode-select")).toHaveCount(0);
  await expect(settings.locator("#beta-mode")).toBeAttached();
  await expect(settings.locator("#beta-team-enabled")).toBeAttached();

  await gear.click();
  await expect(settings).toBeVisible();
  await expect(gear).toBeVisible();
  expect(pageErrors, "Beta no debe lanzar errores JavaScript al abrirse").toEqual([]);
});
