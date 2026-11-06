import { expect, test, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";
import {
  PHOTOS,
  audit,
  expectNoHorizontalScroll,
  findCourierTask,
  pickFreeSlot,
  watchErrors,
} from "./helpers";

/** The committed demo opened straight from disk — exactly what a double click does. */
const DEMO_URL = new URL("../../demo/index.html", import.meta.url).href;
const DESKTOP = { width: 1280, height: 900 };
const PHONE = { width: 375, height: 812 };

test.beforeAll(() => {
  // Fail with a clear message if the demo has not been built.
  expect(DEMO_URL.startsWith("file://")).toBeTruthy();
  expect(fileURLToPath(DEMO_URL)).toMatch(/demo[\\/]index\.html$/);
});

function demoBar(page: Page) {
  return page.getByRole("region", { name: "Демо-режим" });
}

/** «Войти как …» in the demo bar instead of a login form. */
async function switchRole(page: Page, label: "Клиент" | "Эксперт" | "Курьер" | "Админ") {
  const button = demoBar(page).getByRole("button", { name: label, exact: true });
  await button.click();
  await expect(button).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
}

/** Time controls; on a phone they are behind the «Время и сброс» toggle. */
async function travel(page: Page, label: string) {
  const bar = demoBar(page);
  const toggle = bar.getByRole("button", { name: "Время и сброс" });
  if (await toggle.isVisible()) await toggle.click();
  await bar.getByRole("button", { name: label }).click();
}

test("демо из file://: полный путь заявки всеми ролями, перемотка времени и сброс", async ({
  page,
}) => {
  await page.setViewportSize(DESKTOP);
  const errors = watchErrors(page);
  let number = "";
  let applicationUrl = "";

  await test.step("лэндинг открывается с диска, калькулятор считает без сервера", async () => {
    await page.goto(DEMO_URL);
    await expect(page).toHaveTitle(/Ломбард онлайн/);
    await expect(demoBar(page)).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    // Шрифты подключены локально (@font-face из demo/fonts).
    await expect
      .poll(() => page.evaluate(() => document.fonts.check('16px "Golos Text"', "Ломбард")))
      .toBe(true);
    await page.locator("#calculator").scrollIntoViewIfNeeded();
    await expect(page.locator("#calculator")).toContainText("₸");
    await audit(page);
  });

  await test.step("клиент (переключатель ролей) создаёт заявку с фото", async () => {
    await switchRole(page, "Клиент");
    await expect(page).toHaveURL(/#\/client$/);
    await expect(page.getByText("Кольцо с бриллиантом")).toBeVisible();
    await audit(page);
    await page.getByRole("link", { name: "Новая заявка" }).first().click();
    await page.getByRole("radio", { name: /^Золото/ }).check();
    await page.getByLabel("Название изделия").fill("Кольцо с фианитом");
    await page.getByRole("button", { name: "Далее" }).click();
    await page.getByLabel("Проба").selectOption("585");
    await page.getByLabel("Вес").fill("4,2");
    await page.getByLabel("Состояние").selectOption({ label: "Хорошее" });
    await page.getByRole("button", { name: "Далее" }).click();
    await page.locator('input[type="file"]').setInputFiles(PHOTOS);
    await expect(page.getByRole("list", { name: "Фото: 3 из 6" })).toBeVisible();
    await expect(page.getByText(/качество хорошее/)).toHaveCount(3);
    await audit(page);
    await page.getByRole("button", { name: "Перейти к проверке" }).click();
    await page.getByRole("button", { name: "Отправить на оценку" }).click();
    await expect(page).toHaveURL(/#\/client\/applications\/\d+$/);
    await expect(page.getByRole("heading", { name: "Предварительная оценка" })).toBeVisible();
    await expect(page.getByRole("complementary")).toContainText(/\d\s–\s\d.*₸/);
    const subtitle = await page.getByText(/Заявка № Л-\d+/).textContent();
    number = subtitle!.match(/Л-\d+/)![0];
    applicationUrl = page.url();
    await audit(page);
  });

  await test.step("эксперт берёт заявку и отправляет предложение", async () => {
    await switchRole(page, "Эксперт");
    await page.getByRole("link", { name: new RegExp(`№ ${number},`) }).click();
    await page.getByRole("button", { name: "Взять в работу" }).click();
    await audit(page);
    await page.getByRole("button", { name: "Увеличить" }).click();
    await expect(page.getByText("150 %")).toBeVisible();
    await page.getByLabel("Рыночная стоимость").fill("150 000");
    await expect(page.getByText("Клиент получит").locator("..")).toContainText("₸");
    await page.getByLabel("Комментарий клиенту").fill("Клеймо и вес совпадают с описанием");
    await page.getByRole("button", { name: "Отправить предложение" }).click();
    await expect(page.getByText("Предложение отправлено").first()).toBeVisible();
  });

  await test.step("клиент принимает предложение и вызывает курьера", async () => {
    await switchRole(page, "Клиент");
    await page.goto(applicationUrl);
    const offer = page.getByRole("region", { name: "Предложение эксперта" });
    await expect(offer).toContainText("120 000 ₸");
    await expect(offer).toContainText("Клеймо и вес совпадают с описанием");
    await page.getByRole("button", { name: "Принять и вызвать курьера" }).click();
    await expect(page.getByRole("heading", { name: "Вызов курьера" })).toBeVisible();
    await page.getByLabel("Адрес").fill("пр. Абылай хана, 79, кв. 12");
    await audit(page);
    await pickFreeSlot(page);
    await page.getByRole("button", { name: "Вызвать курьера" }).click();
    await expect(page.getByRole("heading", { name: "Курьер заберёт изделие" })).toBeVisible();
  });

  await test.step("курьер на телефоне забирает и доставляет изделие", async () => {
    await page.setViewportSize(PHONE);
    await switchRole(page, "Курьер");
    const card = await findCourierTask(page, number);
    await audit(page);
    await expectNoHorizontalScroll(page);
    await card.getByRole("button", { name: "Выехал к клиенту" }).click();
    await card.getByRole("button", { name: "Изделие у меня" }).click();
    await card.getByRole("button", { name: "Доставил в ломбард" }).click();
    await expect(card).toBeHidden();
    await page.setViewportSize(DESKTOP);
  });

  await test.step("эксперт подтверждает осмотр", async () => {
    await switchRole(page, "Эксперт");
    await page.getByRole("link", { name: "Осмотр" }).click();
    await page.getByRole("link", { name: new RegExp(`№ ${number},`) }).click();
    await expect(page.getByRole("heading", { name: "Осмотр в ломбарде" })).toBeVisible();
    await page.getByRole("button", { name: "Подтвердить осмотр" }).click();
    await expect(page.getByRole("button", { name: "Подтвердить осмотр" })).toBeHidden();
  });

  await test.step("клиент получает деньги (отказ банка, затем успех) и продлевает займ", async () => {
    await switchRole(page, "Клиент");
    await page.goto(applicationUrl);
    await expect(page.getByRole("heading", { name: "Осмотр пройден" })).toBeVisible();
    const cardField = page.getByLabel("Карта для зачисления");
    await cardField.fill("4000 0000 0000 0002");
    await page.getByRole("button", { name: "Получить 120 000 ₸" }).click();
    await expect(page.getByRole("alert").filter({ hasText: /банк|отклон/i })).toBeVisible();
    await cardField.fill("4400 4301 2345 6789");
    await page.getByRole("button", { name: "Получить 120 000 ₸" }).click();
    await expect(page.getByRole("heading", { name: /Залоговый билет № ЗБ-/ })).toBeVisible();

    // Залоговый билет открывается в новой вкладке (HTML из мок-API).
    const [ticket] = await Promise.all([
      page.context().waitForEvent("page"),
      page.getByRole("button", { name: "Залоговый билет" }).first().click(),
    ]);
    await expect(ticket.getByRole("heading", { name: "Залоговый билет" })).toBeVisible();
    await expect(ticket.locator("body")).toContainText("120 000 ₸");
    await ticket.close();

    await page.getByRole("link", { name: "Погасить или продлить" }).click();
    await page.getByRole("button", { name: "Продлить" }).click();
    const dialog = page.getByRole("dialog", { name: "Продлить займ" });
    await dialog.getByRole("radio", { name: "7 дней", exact: true }).check();
    await dialog.getByLabel("Карта для оплаты").fill("4400 4301 2345 6789");
    await dialog.getByRole("button", { name: /^Оплатить/ }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole("region", { name: "Платежи" })).toContainText(
      "Оплата процентов (продление)",
    );
  });

  await test.step("перемотка времени из панели демо — займ просрочен", async () => {
    await travel(page, "Перемотать на 7 дней вперёд");
    await expect(demoBar(page)).toContainText("+7 дней");
    await travel(page, "Перемотать на 1 день вперёд");
    await expect(demoBar(page)).toContainText("+8 дней");
    await expect(page.getByRole("alert").filter({ hasText: /Просрочка/ })).toBeVisible();
    await audit(page);
    await page.getByRole("button", { name: /^Погасить/ }).click();
    const dialog = page.getByRole("dialog", { name: "Погасить займ" });
    await expect(dialog).toContainText("Проценты за 8 дней");
    await dialog.getByRole("button", { name: "4400 4301 2345 6789" }).click();
    await dialog.getByRole("button", { name: /^Оплатить/ }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText("Погашен").first()).toBeVisible();
  });

  await test.step("админ видит статистику, время возвращается к сегодняшнему", async () => {
    await switchRole(page, "Админ");
    await expect(page.getByRole("heading", { name: "Время приложения" })).toBeVisible();
    await expect(page.getByText(/впереди реального на 8 дн/)).toBeVisible();
    await audit(page);
    await travel(page, "Вернуть сегодня");
    await expect(demoBar(page)).toContainText("В демо сегодня");
  });

  await test.step("клиент вызывает курьера для возврата, курьер возвращает изделие", async () => {
    await switchRole(page, "Клиент");
    await page.goto(applicationUrl);
    await expect(page.getByRole("heading", { name: "Вернуть изделие" })).toBeVisible();
    await expect(page.getByLabel("Адрес")).toHaveValue("пр. Абылай хана, 79, кв. 12");
    await pickFreeSlot(page);
    await page.getByRole("button", { name: "Вызвать курьера" }).click();
    await expect(page.getByRole("button", { name: "Вызвать курьера" })).toBeHidden();

    await switchRole(page, "Курьер");
    const card = await findCourierTask(page, number);
    await card.getByRole("button", { name: "Выехал с изделием" }).click();
    await card.getByRole("button", { name: "Передал клиенту" }).click();
    await expect(card).toBeHidden();

    await switchRole(page, "Клиент");
    await page.goto(applicationUrl);
    await expect(page.getByText("Изделие возвращено").first()).toBeVisible();
  });

  await test.step("данные переживают перезагрузку, «Сбросить демо» возвращает исходные", async () => {
    await page.reload();
    await expect(page.getByText("Изделие возвращено").first()).toBeVisible();
    const reset = demoBar(page).getByRole("button", { name: "Сбросить демо" });
    await reset.click();
    await demoBar(page)
      .getByRole("button", { name: /Точно сбросить/ })
      .click();
    await expect(page).toHaveURL(/#\/$/);
    await expect(demoBar(page).getByRole("button", { name: "Клиент" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    await switchRole(page, "Клиент");
    await expect(page.getByText("Кольцо с бриллиантом")).toBeVisible();
    await expect(page.getByText(number)).toHaveCount(0);
  });

  expect(errors).toEqual([]);
});

test("демо: панель и экраны без горизонтальной прокрутки на 360 px", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 760 });
  const errors = watchErrors(page);
  await page.goto(DEMO_URL);
  await expectNoHorizontalScroll(page);
  await audit(page);
  for (const role of ["Клиент", "Эксперт", "Курьер", "Админ"] as const) {
    await switchRole(page, role);
    await expectNoHorizontalScroll(page);
  }
  await demoBar(page).getByRole("button", { name: "Время и сброс" }).click();
  await expect(demoBar(page).getByRole("button", { name: "Сбросить демо" })).toBeVisible();
  await expectNoHorizontalScroll(page);
  await audit(page);
  expect(errors).toEqual([]);
});
