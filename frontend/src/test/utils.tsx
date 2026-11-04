import { render } from "@testing-library/react";
import type { ReactElement } from "react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { vi } from "vitest";
import { AppRoutes, Providers } from "../App";
import { reloadTokens } from "../api/client";
import { createQueryClient } from "../lib/queryClient";
import { ROUTER_FUTURE } from "../lib/router";

type Handler = (body: unknown, init: RequestInit) => unknown;

/** Ответ-ошибка от мок-сервера. */
export class MockHttpError {
  constructor(
    public status: number,
    public body: unknown,
  ) {}
}

/**
 * Мок `fetch` по таблице маршрутов: `"POST /api/auth/login": (body) => ({...})`.
 * Обработчик может вернуть `MockHttpError` или выбросить исключение (сетевая ошибка).
 */
export function mockApi(routes: Record<string, Handler>) {
  const fn = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = typeof input === "string" ? input : input.toString();
    const key = `${(init.method ?? "GET").toUpperCase()} ${url.split("?")[0]}`;
    const handler = routes[key];
    if (!handler)
      return new Response(JSON.stringify({ detail: `нет мока: ${key}` }), { status: 404 });
    const body = typeof init.body === "string" ? JSON.parse(init.body) : init.body;
    const result = await handler(body, init);
    if (result instanceof MockHttpError) {
      return new Response(JSON.stringify(result.body), { status: result.status });
    }
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

export function LocationProbe() {
  const loc = useLocation();
  return <output data-testid="location">{loc.pathname + loc.hash}</output>;
}

/** Всё приложение на MemoryRouter с нужного адреса. */
export function renderApp(path = "/") {
  reloadTokens();
  const client = createQueryClient();
  client.setDefaultOptions({ queries: { retry: false } });
  return render(
    <Providers client={client}>
      <MemoryRouter initialEntries={[path]} future={ROUTER_FUTURE}>
        <AppRoutes />
        <LocationProbe />
      </MemoryRouter>
    </Providers>,
  );
}

/** Отдельный компонент с провайдерами (без маршрутов приложения). */
export function renderWithProviders(ui: ReactElement, path = "/") {
  reloadTokens();
  const client = createQueryClient();
  client.setDefaultOptions({ queries: { retry: false } });
  return render(
    <Providers client={client}>
      <MemoryRouter initialEntries={[path]} future={ROUTER_FUTURE}>
        <Routes>
          <Route path="*" element={ui} />
        </Routes>
        <LocationProbe />
      </MemoryRouter>
    </Providers>,
  );
}

export const CATEGORIES = [
  {
    id: 1,
    code: "gold",
    name: "Золото",
    description: null,
    ltv_percent: 80,
    daily_rate_bp: 25,
    min_term_days: 7,
    max_term_days: 60,
    requires_metal: true,
    allowed_metals: ["GOLD"],
  },
  {
    id: 4,
    code: "watches",
    name: "Часы",
    description: null,
    ltv_percent: 60,
    daily_rate_bp: 30,
    min_term_days: 7,
    max_term_days: 60,
    requires_metal: false,
    allowed_metals: [],
  },
  {
    id: 5,
    code: "electronics",
    name: "Электроника",
    description: null,
    ltv_percent: 50,
    daily_rate_bp: 40,
    min_term_days: 7,
    max_term_days: 30,
    requires_metal: false,
    allowed_metals: [],
  },
];

export const METALS = [
  {
    metal: "GOLD",
    label: "Золото",
    finenesses: [375, 585, 750],
    price_per_gram: 6650000,
    effective_from: null,
  },
];

export const CONDITIONS = [
  { condition: "NEW", label: "Новое" },
  { condition: "GOOD", label: "Хорошее" },
];

export function calcResult(loan: number, term = 30, rateBp = 25) {
  const interest = Math.round((loan * rateBp * term) / 10_000);
  return {
    category_id: 1,
    category_name: "Золото",
    ltv_percent: 80,
    market_value: loan / 0.8,
    value_min: 12_170_000,
    value_max: 19_530_000,
    estimated: true,
    estimate_steps: [],
    max_loan_amount: loan,
    quote: {
      loan_amount: loan,
      daily_rate_bp: rateBp,
      rate_label: "0,25 % в день",
      annual_rate_percent: 91.25,
      term_days: term,
      interest,
      total_to_repay: loan + interest,
      start_date: "2026-11-04",
      due_date: "2026-12-04",
      grace_until: "2027-01-03",
      schedule: [],
    },
  };
}

export const catalogRoutes = {
  "GET /api/catalog/categories": () => CATEGORIES,
  "GET /api/catalog/metals": () => METALS,
  "GET /api/catalog/conditions": () => CONDITIONS,
};

export function userFixture(role: "CLIENT" | "EXPERT" | "COURIER" | "ADMIN" = "CLIENT") {
  return {
    id: 1,
    email: `${role.toLowerCase()}@lombard.kz`,
    full_name: role === "CLIENT" ? "Айгерим Садыкова" : "Ерлан Касымов",
    phone: "+77011234567",
    phone_display: "+7 701 123-45-67",
    role,
    is_active: true,
    city: "Алматы",
    created_at: "2026-11-01T00:00:00Z",
    last_login_at: null,
  };
}

export function authResponse(role: Parameters<typeof userFixture>[0] = "CLIENT") {
  return {
    access_token: "access-1",
    refresh_token: "refresh-1",
    token_type: "bearer",
    access_expires_at: "2026-11-04T12:00:00Z",
    refresh_expires_at: "2026-11-18T12:00:00Z",
    user: userFixture(role),
  };
}
