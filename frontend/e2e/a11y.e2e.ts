import { expect, test, type Page } from "@playwright/test";
import { DEMO, DEMO_PASSWORD, audit, expectNoHorizontalScroll, watchErrors } from "./helpers";

/** Screens of every role; detail pages are reached through the first link of a list. */
const SCREENS: { role: string; email?: string; paths: string[] }[] = [
  { role: "гость", paths: ["/", "/login", "/register", "/no-such-page"] },
  {
    role: "клиент",
    email: "client@lombard.kz",
    paths: ["/client", "/client/new", "/client/loans"],
  },
  { role: "эксперт", email: DEMO.expert, paths: ["/expert", "/expert/inspections"] },
  { role: "курьер", email: DEMO.courier, paths: ["/courier"] },
  {
    role: "админ",
    email: DEMO.admin,
    paths: ["/admin", "/admin/catalog", "/admin/users", "/admin/couriers"],
  },
];

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Пароль").fill(DEMO_PASSWORD);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

async function settle(page: Page) {
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("status", { name: "Загрузка" })).toHaveCount(0);
}

for (const { role, email, paths } of SCREENS) {
  test(`доступность и адаптив: ${role}`, async ({ page }) => {
    const errors = watchErrors(page);
    if (email) await login(page, email);
    const visit: string[] = [...paths];
    // One detail screen per list: open the first card if there is one.
    for (const path of paths) {
      await page.goto(path);
      await settle(page);
      const detail = page
        .locator('main a[href*="/applications/"], main a[href*="/loans/"]')
        .first();
      if (await detail.count()) {
        const href = await detail.getAttribute("href");
        if (href && !visit.includes(href)) visit.push(href);
      }
    }
    for (const path of visit) {
      await test.step(path, async () => {
        await page.setViewportSize({ width: 1280, height: 900 });
        await page.goto(path);
        await settle(page);
        await audit(page);
        await page.setViewportSize({ width: 360, height: 780 });
        await settle(page);
        await expectNoHorizontalScroll(page);
        await audit(page);
      });
    }
    expect(errors).toEqual([]);
  });
}
