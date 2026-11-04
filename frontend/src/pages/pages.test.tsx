import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { setTokens } from "../api/client";
import type { CalculatorInput } from "../api/types";
import {
  MockHttpError,
  authResponse,
  calcResult,
  catalogRoutes,
  mockApi,
  renderApp,
  userFixture,
} from "../test/utils";

// Testing Library нормализует пробелы, в том числе неразрывные, — сравниваем с обычными.
const NB = " ";

describe("Landing", () => {
  it("renders the hero, steps, categories with LTV from the API and FAQ", async () => {
    mockApi({ ...catalogRoutes, "POST /api/calculator": () => calcResult(12_680_000) });
    renderApp("/");
    expect(
      screen.getByRole("heading", { level: 1, name: "Займ под залог без визита в ломбард" }),
    ).toBeInTheDocument();
    for (const link of screen.getAllByRole("link", { name: "Оценить по фото" })) {
      expect(link).toHaveAttribute("href", "/register");
    }
    // минимальная ставка берётся из справочника категорий
    expect(await screen.findByText(`От 0,25${NB}% в день`)).toBeInTheDocument();
    const steps = within(screen.getByRole("region", { name: "Как это работает" })).getAllByRole(
      "listitem",
    );
    expect(steps).toHaveLength(4);
    const accepted = screen.getByRole("region", { name: "Что принимаем" });
    expect(await within(accepted).findByText(`До 80${NB}% от оценки`)).toBeInTheDocument();
    expect(within(accepted).getByText(`До 60${NB}% от оценки`)).toBeInTheDocument();
    expect(screen.getByText("Какие изделия вы принимаете?")).toBeInTheDocument();
  });

  it("calculates a loan live and switches categories", async () => {
    const requests: CalculatorInput[] = [];
    mockApi({
      ...catalogRoutes,
      "POST /api/calculator": (body) => {
        const input = body as CalculatorInput;
        requests.push(input);
        return input.category_code === "watches"
          ? calcResult(5_040_000, input.term_days, 30)
          : calcResult(12_680_000, input.term_days);
      },
    });
    renderApp("/");
    const calc = screen.getByRole("region", { name: "Сколько можно получить" });
    expect(await within(calc).findByText(`126${NB}800${NB}₸`)).toBeInTheDocument();
    expect(requests[0]).toEqual({
      category_code: "gold",
      term_days: 30,
      metal: "GOLD",
      fineness: 585,
      weight_g: 4.2,
    });
    expect(within(calc).getByText(`136${NB}310${NB}₸`)).toBeInTheDocument();
    expect(within(calc).getByText("Вернуть 4 декабря")).toBeInTheDocument();

    // неверный вес — подсказка и без запроса
    const weight = within(calc).getByLabelText("Вес");
    await userEvent.clear(weight);
    expect(within(calc).getByText("Укажите вес в граммах, например 4,2")).toBeInTheDocument();

    await userEvent.click(within(calc).getByText("Часы"));
    expect(within(calc).getByLabelText("Бренд")).toBeInTheDocument();
    expect(await within(calc).findByText(`50${NB}400${NB}₸`)).toBeInTheDocument();
    expect(requests.at(-1)).toEqual({ category_code: "watches", term_days: 30, condition: "GOOD" });
  });

  it("explains when the calculator cannot load", async () => {
    mockApi({
      "GET /api/catalog/categories": () => {
        throw new TypeError("Failed to fetch");
      },
      "GET /api/catalog/metals": () => [],
      "GET /api/catalog/conditions": () => [],
    });
    renderApp("/");
    expect(await screen.findByText("Калькулятор недоступен")).toBeInTheDocument();
  });
});

describe("Auth", () => {
  it("sends guests from a cabinet to login and back after signing in", async () => {
    mockApi({
      ...catalogRoutes,
      "POST /api/auth/login": (body) => {
        expect(body).toEqual({ email: "client@lombard.kz", password: "demo1234" });
        return authResponse("CLIENT");
      },
      "GET /api/notifications/unread-count": () => ({ unread: 2 }),
    });
    renderApp("/client/loans");
    expect(await screen.findByRole("heading", { name: "Вход" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /client@lombard\.kz/ }));
    await userEvent.click(screen.getByRole("button", { name: "Войти" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Займы" })).toBeInTheDocument();
    expect(screen.getByTestId("location")).toHaveTextContent("/client/loans");
    expect(screen.getByText("Здравствуйте, Айгерим")).toBeInTheDocument();
    expect(
      await screen.findByRole("img", { name: "Непрочитанных уведомлений: 2" }),
    ).toBeInTheDocument();
    const nav = screen.getByRole("navigation", { name: "Разделы кабинета" });
    expect(
      within(nav)
        .getAllByRole("link")
        .map((a) => a.textContent),
    ).toEqual(["Мои заявки", "Новая заявка", "Займы"]);
  });

  it("shows validation and server errors on login", async () => {
    mockApi({
      ...catalogRoutes,
      "POST /api/auth/login": () =>
        new MockHttpError(401, { detail: "Неверный e-mail или пароль" }),
    });
    renderApp("/login");
    await userEvent.click(screen.getByRole("button", { name: "Войти" }));
    expect(screen.getByLabelText("E-mail")).toHaveAccessibleDescription("Введите e-mail");
    await userEvent.type(screen.getByLabelText("E-mail"), "client@lombard.kz");
    await userEvent.type(screen.getByLabelText("Пароль"), "wrong123");
    await userEvent.click(screen.getByRole("button", { name: "Войти" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Неверный e-mail или пароль");
  });

  it("registers a client with a normalized phone and maps field errors", async () => {
    let attempt = 0;
    mockApi({
      ...catalogRoutes,
      "POST /api/auth/register": (body) => {
        attempt++;
        if (attempt === 1) {
          return new MockHttpError(409, { detail: "Пользователь с таким e-mail уже существует" });
        }
        expect(body).toEqual({
          full_name: "Данияр Ахметов",
          email: "daniyar@mail.kz",
          phone: "+77771234568",
          city: "Астана",
          password: "secret123",
        });
        return authResponse("CLIENT");
      },
      "GET /api/notifications/unread-count": () => ({ unread: 0 }),
    });
    renderApp("/register");
    await userEvent.type(screen.getByLabelText("Имя и фамилия"), "Данияр Ахметов");
    await userEvent.type(screen.getByLabelText("E-mail"), "daniyar@mail.kz");
    await userEvent.type(screen.getByLabelText("Телефон"), "87771234568");
    expect(screen.getByLabelText("Телефон")).toHaveValue("+7 777 123-45-68");
    await userEvent.clear(screen.getByLabelText("Город"));
    await userEvent.type(screen.getByLabelText("Город"), "Астана");
    await userEvent.type(screen.getByLabelText("Пароль"), "short");
    await userEvent.click(screen.getByRole("button", { name: "Создать аккаунт" }));
    expect(screen.getByLabelText("Пароль")).toHaveAccessibleDescription("Минимум 8 символов");

    await userEvent.clear(screen.getByLabelText("Пароль"));
    await userEvent.type(screen.getByLabelText("Пароль"), "secret123");
    await userEvent.click(screen.getByRole("button", { name: "Создать аккаунт" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("уже существует");

    await userEvent.click(screen.getByRole("button", { name: "Создать аккаунт" }));
    expect(
      await screen.findByRole("heading", { level: 1, name: "Мои заявки" }),
    ).toBeInTheDocument();
  });

  it("restores the session and keeps users inside their role", async () => {
    setTokens({ access: "a", refresh: "r" });
    mockApi({
      ...catalogRoutes,
      "GET /api/auth/me": () => userFixture("EXPERT"),
      "GET /api/notifications/unread-count": () => ({ unread: 0 }),
    });
    renderApp("/admin/users");
    expect(await screen.findByRole("heading", { level: 1, name: "Очередь" })).toBeInTheDocument();
    expect(screen.getByTestId("location")).toHaveTextContent("/expert");
  });

  it("logs out from the user menu", async () => {
    setTokens({ access: "a", refresh: "r" });
    mockApi({
      ...catalogRoutes,
      "GET /api/auth/me": () => userFixture("COURIER"),
      "GET /api/notifications/unread-count": () => ({ unread: 0 }),
      "POST /api/calculator": () => calcResult(12_680_000),
    });
    renderApp("/courier");
    await userEvent.click(await screen.findByRole("button", { name: /Ерлан Касымов/ }));
    await userEvent.click(screen.getByRole("button", { name: "Выйти" }));
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent(/^\/$/));
    expect(screen.getByText("Вы вышли из кабинета")).toBeInTheDocument();
    expect(localStorage.getItem("lombard.auth")).toBeNull();
    expect(screen.getByRole("link", { name: "Войти" })).toBeInTheDocument();
  });

  it("shows a helpful 404 page", () => {
    mockApi(catalogRoutes);
    renderApp("/nowhere");
    expect(screen.getByRole("heading", { name: "Такой страницы нет" })).toBeInTheDocument();
  });
});
