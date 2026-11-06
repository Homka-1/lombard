import {
  expect,
  type APIRequestContext,
  type Browser,
  type Locator,
  type Page,
} from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { fileURLToPath } from "node:url";

export const PHOTOS = ["ring-1.jpg", "ring-2.jpg", "ring-3.jpg"].map((name) =>
  fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)),
);

export const DEMO = {
  expert: "expert@lombard.kz",
  courier: "courier@lombard.kz",
  admin: "admin@lombard.kz",
} as const;
export const DEMO_PASSWORD = "demo1234";

/** Collects console errors and failed API calls of a page; checked at the end of a test. */
export function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (msg) => {
    // Ожидаемые отказы API (4xx) браузер тоже пишет в консоль — их проверяют сами тесты.
    if (msg.type() === "error" && !/status of 4\d\d/.test(msg.text())) {
      errors.push(`console: ${msg.text()}`);
    }
  });
  page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));
  page.on("response", (res) => {
    if (res.url().includes("/api/") && res.status() >= 500) {
      errors.push(`api ${res.status()}: ${res.url()}`);
    }
  });
  return errors;
}

/** A separate browser context (own localStorage = own session) logged in as `email`. */
export async function loginAs(
  browser: Browser,
  email: string,
  options: { viewport?: { width: number; height: number } } = {},
) {
  const context = await browser.newContext(options.viewport ? { viewport: options.viewport } : {});
  const page = await context.newPage();
  const errors = watchErrors(page);
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Пароль").fill(DEMO_PASSWORD);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page).not.toHaveURL(/\/login/);
  return { context, page, errors };
}

/** No horizontal page scroll at the current viewport. */
export async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, `horizontal overflow on ${page.url()}`).toBeLessThanOrEqual(0);
}

/**
 * The courier's card of application `number`, expanded. The visit slot may fall on a later
 * day (late in the evening only tomorrow's slots are left), so walk forward day by day;
 * on a busy day only the nearest visit is expanded, the rest are buttons.
 */
export async function findCourierTask(page: Page, number: string): Promise<Locator> {
  const card = page.getByRole("article").filter({ hasText: `№ ${number}` });
  const collapsed = page.getByRole("button", { name: new RegExp(`№ ${number}$`) });
  const heading = page.getByRole("heading", { level: 1 });
  for (let day = 0; day < 8; day += 1) {
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("status", { name: "Загрузка" })).toHaveCount(0);
    if (await collapsed.isVisible()) await collapsed.click();
    if (await card.isVisible()) return card;
    const title = await heading.textContent();
    await page.getByRole("button", { name: "Следующий день" }).click();
    await expect(heading).not.toHaveText(title ?? "");
  }
  throw new Error(`courier task for ${number} not found`);
}

/** Selects the first free courier interval, moving to later days if today is full. */
export async function pickFreeSlot(page: Page) {
  const days = page.getByRole("group", { name: "День" }).locator('input[type="radio"]:enabled');
  await expect(days.first()).toBeAttached();
  const count = await days.count();
  for (let i = 0; i < count; i += 1) {
    await days.nth(i).check();
    const free = page.getByRole("group", { name: "Время" }).locator('input[type="radio"]:enabled');
    if ((await free.count()) > 0) {
      await free.first().check();
      return;
    }
  }
  throw new Error("no free courier slot");
}

/** Back to real time through the API (the clock offset is global for the server). */
export async function resetClock(request: APIRequestContext) {
  const login = await request.post("/api/auth/login", {
    data: { email: DEMO.admin, password: DEMO_PASSWORD },
  });
  expect(login.ok()).toBeTruthy();
  const { access_token } = (await login.json()) as { access_token: string };
  const res = await request.delete("/api/admin/clock", {
    headers: { Authorization: `Bearer ${access_token}` },
  });
  expect(res.ok()).toBeTruthy();
}

/** axe-core audit (WCAG 2.1 A/AA) of the current page state; lists violations on failure. */
export async function audit(page: Page) {
  // Settled state only: no pending requests, spinners or buttons in the middle of an action.
  await page.waitForLoadState("networkidle");
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
  await expect(page.getByRole("status", { name: "Загрузка" })).toHaveCount(0);
  const builder = new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]);
  // With file:// (the demo) axe cannot re-download stylesheets via XHR (CORS) and logs
  // console errors; computed styles are enough for the rules we run.
  if (page.url().startsWith("file:")) builder.options({ preload: false });
  const result = await builder.analyze();
  const summary = result.violations.map(
    (v) =>
      `${v.id} (${v.impact}): ${v.help}\n` +
      v.nodes
        .slice(0, 5)
        .map((n) => `    ${n.target.join(" ")} — ${n.failureSummary?.split("\n")[1] ?? ""}`)
        .join("\n"),
  );
  expect(summary, `axe on ${page.url()}`).toEqual([]);
}
