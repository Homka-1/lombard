import { expect, test } from "@playwright/test";
import {
  DEMO,
  PHOTOS,
  audit,
  expectNoHorizontalScroll,
  findCourierTask,
  pickFreeSlot,
  resetClock,
  loginAs,
  watchErrors,
} from "./helpers";

test("полный путь заявки: клиент → эксперт → курьер → выдача → погашение → возврат", async ({
  page,
  browser,
  request,
}) => {
  await resetClock(request);
  const clientErrors = watchErrors(page);
  const email = `e2e.${Date.now()}@example.kz`;
  let number = "";
  let applicationUrl = "";

  await test.step("клиент регистрируется", async () => {
    await page.goto("/register");
    await page.getByLabel("Имя и фамилия").fill("Дана Сейтказиева");
    await page.getByLabel("E-mail").fill(email);
    await page.getByLabel("Телефон").fill("+7 701 555-12-34");
    await page.getByLabel("Пароль").fill("secret123");
    await page.getByRole("button", { name: "Создать аккаунт" }).click();
    await expect(page).toHaveURL(/\/client$/);
  });

  await test.step("клиент создаёт заявку с фото и получает предоценку", async () => {
    await page.goto("/client/new");
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
    await expect(page).toHaveURL(/\/client\/applications\/\d+$/);
    await expect(page.getByRole("heading", { name: "Предварительная оценка" })).toBeVisible();
    await expect(page.getByRole("complementary")).toContainText(/\d\s–\s\d.*₸/);
    const subtitle = await page.getByText(/Заявка № Л-\d+/).textContent();
    number = subtitle!.match(/Л-\d+/)![0];
    applicationUrl = page.url();
    await audit(page);
  });

  const expert = await loginAs(browser, DEMO.expert);
  await test.step("эксперт берёт заявку и отправляет предложение", async () => {
    const p = expert.page;
    await p.goto("/expert");
    await p.getByRole("link", { name: new RegExp(`№ ${number},`) }).click();
    await p.getByRole("button", { name: "Взять в работу" }).click();
    await audit(p);
    await p.getByRole("button", { name: "Увеличить" }).click();
    await expect(p.getByText("150 %")).toBeVisible();
    await p.getByLabel("Рыночная стоимость").fill("150 000");
    await expect(p.getByText("Клиент получит").locator("..")).toContainText("₸");
    await p.getByLabel("Комментарий клиенту").fill("Клеймо и вес совпадают с описанием");
    await p.getByRole("button", { name: "Отправить предложение" }).click();
    await expect(p.getByText("Предложение отправлено").first()).toBeVisible();
  });

  await test.step("клиент принимает предложение и вызывает курьера", async () => {
    await page.goto(applicationUrl);
    const offer = page.getByRole("region", { name: "Предложение эксперта" });
    await expect(offer).toContainText("120 000 ₸");
    await expect(offer).toContainText("Клеймо и вес совпадают с описанием");
    await audit(page);
    await page.getByRole("button", { name: "Принять и вызвать курьера" }).click();
    await expect(page.getByRole("heading", { name: "Вызов курьера" })).toBeVisible();
    await page.getByLabel("Адрес").fill("пр. Абылай хана, 79, кв. 12");
    await audit(page);
    await pickFreeSlot(page);
    await page.getByLabel("Комментарий").fill("Домофон 12, третий этаж");
    await page.getByRole("button", { name: "Вызвать курьера" }).click();
    await expect(page.getByRole("heading", { name: "Курьер заберёт изделие" })).toBeVisible();
    await expect(page.getByText("Алматы, пр. Абылай хана, 79, кв. 12")).toBeVisible();
  });

  const courier = await loginAs(browser, DEMO.courier, { viewport: { width: 375, height: 812 } });
  await test.step("курьер забирает изделие и доставляет в ломбард", async () => {
    const p = courier.page;
    await p.goto("/courier");
    const card = await findCourierTask(p, number);
    await audit(p);
    await card.getByRole("button", { name: "Выехал к клиенту" }).click();
    await card.getByRole("button", { name: "Изделие у меня" }).click();
    await card.getByRole("button", { name: "Доставил в ломбард" }).click();
    await expect(card).toBeHidden();
    await expectNoHorizontalScroll(p);
  });

  await test.step("эксперт подтверждает осмотр", async () => {
    const p = expert.page;
    await p.goto("/expert/inspections");
    await p.getByRole("link", { name: new RegExp(`№ ${number},`) }).click();
    await expect(p.getByRole("heading", { name: "Осмотр в ломбарде" })).toBeVisible();
    await audit(p);
    await p.getByRole("button", { name: "Подтвердить осмотр" }).click();
    await expect(p.getByRole("button", { name: "Подтвердить осмотр" })).toBeHidden();
  });

  await test.step("клиент получает деньги на карту", async () => {
    await page.goto(applicationUrl);
    await expect(page.getByRole("heading", { name: "Осмотр пройден" })).toBeVisible();
    const card = page.getByLabel("Карта для зачисления");
    // Учебный банк отклоняет эту карту — проверяем сообщение об ошибке.
    await card.fill("4000 0000 0000 0002");
    await page.getByRole("button", { name: "Получить 120 000 ₸" }).click();
    await expect(page.getByRole("alert").filter({ hasText: /банк|отклон/i })).toBeVisible();
    await expect(card).toHaveAttribute("aria-invalid", "true");
    await audit(page);
    await card.fill("4400 4301 2345 6789");
    await page.getByRole("button", { name: "Получить 120 000 ₸" }).click();
    await expect(page.getByRole("heading", { name: /Залоговый билет № ЗБ-/ })).toBeVisible();
    await expect(page.getByText("Займ действует").first()).toBeVisible();
  });

  await test.step("клиент продлевает займ", async () => {
    await page.getByRole("link", { name: "Погасить или продлить" }).click();
    await page.getByRole("button", { name: "Продлить" }).click();
    const dialog = page.getByRole("dialog", { name: "Продлить займ" });
    await audit(page);
    await dialog.getByRole("radio", { name: "7 дней", exact: true }).check();
    await dialog.getByLabel("Карта для оплаты").fill("4400 4301 2345 6789");
    await dialog.getByRole("button", { name: /^Оплатить/ }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole("region", { name: "Платежи" })).toContainText(
      "Оплата процентов (продление)",
    );
  });

  const admin = await loginAs(browser, DEMO.admin);
  await test.step("админ перематывает время — займ просрочен", async () => {
    const p = admin.page;
    await expect(p.getByRole("heading", { name: "Время приложения" })).toBeVisible();
    await p.getByRole("button", { name: "+7 дней" }).click();
    await expect(p.getByText(/впереди реального на 7 дн/)).toBeVisible();
    await p.getByRole("button", { name: "+1 день" }).click();
    await expect(p.getByText(/впереди реального на 8 дн/)).toBeVisible();
    await expect(p.getByText(/[1-9]\d* займ\S* в льготном периоде/)).toBeVisible();
  });

  await test.step("клиент видит просрочку и гасит займ", async () => {
    await page.reload();
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

  await test.step("админ возвращает реальное время", async () => {
    await admin.page.getByRole("button", { name: "Вернуть реальное время" }).click();
    await expect(admin.page.getByRole("button", { name: "Вернуть реальное время" })).toBeHidden();
  });

  await test.step("клиент вызывает курьера для возврата изделия", async () => {
    await page.goto(applicationUrl);
    await expect(page.getByRole("heading", { name: "Вернуть изделие" })).toBeVisible();
    await expect(page.getByLabel("Адрес")).toHaveValue("пр. Абылай хана, 79, кв. 12");
    await pickFreeSlot(page);
    await page.getByRole("button", { name: "Вызвать курьера" }).click();
    await expect(page.getByRole("button", { name: "Вызвать курьера" })).toBeHidden();
  });

  await test.step("курьер возвращает изделие клиенту", async () => {
    const p = courier.page;
    await p.goto("/courier");
    const card = await findCourierTask(p, number);
    await card.getByRole("button", { name: "Выехал с изделием" }).click();
    await card.getByRole("button", { name: "Передал клиенту" }).click();
    await expect(card).toBeHidden();
  });

  await test.step("клиент видит, что изделие возвращено", async () => {
    await page.goto(applicationUrl);
    await expect(page.getByText("Изделие возвращено").first()).toBeVisible();
    await audit(page);
    await page.goto("/client");
    await page.getByRole("radio", { name: /Завершённые/ }).check();
    await expect(page.getByRole("link", { name: new RegExp(number) })).toBeVisible();
  });

  for (const session of [expert, courier, admin]) await session.context.close();
  expect(clientErrors, "клиент").toEqual([]);
  expect(expert.errors, "эксперт").toEqual([]);
  expect(courier.errors, "курьер").toEqual([]);
  expect(admin.errors, "админ").toEqual([]);
});
