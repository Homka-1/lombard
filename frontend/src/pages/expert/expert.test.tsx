import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { setTokens } from "../../api/client";
import type { Application, QueueItem } from "../../api/types";
import { appFixture, offer, photo, quote } from "../../test/fixtures";
import { catalogRoutes, MockHttpError, mockApi, renderApp, userFixture } from "../../test/utils";
import {
  formatTengeInput,
  parseRateInput,
  parseTengeInput,
  queuedAt,
  shortName,
  slaOf,
} from "./expertLib";

const session = {
  "GET /api/auth/me": () => userFixture("EXPERT"),
  "GET /api/notifications/unread-count": () => ({ unread: 0 }),
};

beforeEach(() => setTokens({ access: "a", refresh: "r" }));

const pre = {
  id: 1,
  kind: "AUTO" as const,
  value_min: 11_200_000,
  value_max: 12_700_000,
  value: 11_900_000,
  confidence: 92,
  comment: null,
  details: {
    photos: {
      confidence: 92,
      issues: ["Фото 2: слишком тёмное"],
      photos: [
        { index: 1, score: 90, issues: [], duplicate_of: null },
        { index: 2, score: 40, issues: ["слишком тёмное"], duplicate_of: null },
      ],
    },
  },
  created_at: "2026-11-04T09:41:00Z",
};

const reviewApp = (over: Partial<Application> = {}) =>
  appFixture({
    status: "PRE_ESTIMATED",
    status_label: "Предоценка готова",
    submitted_at: "2026-11-04T09:40:00Z",
    editable: false,
    can_submit: false,
    photos: [photo(1), photo(2, 40)],
    pre_estimate: pre,
    actions: ["take"],
    ...over,
  });

function queueItem(over: Partial<QueueItem> = {}): QueueItem {
  return {
    id: 7,
    number: "10-482",
    status: "PRE_ESTIMATED",
    status_label: "Предоценка готова",
    title: "Кольцо с камнем",
    category: { id: 1, code: "gold", name: "Золото", requires_metal: true, ltv_percent: 80 },
    photo_count: 4,
    cover_thumb_url: null,
    pre_estimate_min: 11_200_000,
    pre_estimate_max: 12_700_000,
    created_at: "2026-11-04T09:30:00Z",
    submitted_at: new Date(Date.now() - 20 * 60_000).toISOString(),
    updated_at: "2026-11-04T09:40:00Z",
    client: { id: 1, full_name: "Айгерим Садыкова", phone: null, city: "Алматы" },
    expert: null,
    pre_estimate_value: 11_900_000,
    pre_estimate_confidence: 92,
    requested_amount: 9_000_000,
    ...over,
  };
}

describe("expertLib", () => {
  it("parses money and rate inputs", () => {
    expect(parseTengeInput("119 000")).toBe(11_900_000);
    expect(parseTengeInput("119000,5")).toBe(11_900_050);
    expect(parseTengeInput("")).toBeNull();
    expect(parseTengeInput("abc")).toBeNull();
    expect(formatTengeInput("0119000x")).toBe("119 000");
    expect(parseRateInput("0,2")).toBe(20);
    expect(parseRateInput("0.25")).toBe(25);
    expect(parseRateInput("0")).toBeNull();
  });

  it("measures waiting against the 15-minute norm", () => {
    const now = new Date("2026-11-04T10:00:00Z");
    expect(slaOf("2026-11-04T09:52:00Z", now)).toEqual({ waited: 8, left: 7, late: false });
    expect(slaOf("2026-11-04T09:30:00Z", now).late).toBe(true);
    expect(shortName("Айгерим Касымова")).toBe("Айгерим К.");
    const app = reviewApp({
      history: [
        {
          id: 2,
          from_status: "SUBMITTED",
          to_status: "PRE_ESTIMATED",
          to_status_label: "Предоценка готова",
          actor_role: null,
          comment: null,
          created_at: "2026-11-04T09:41:00Z",
        },
      ],
    });
    expect(queuedAt(app)).toBe("2026-11-04T09:41:00Z");
  });
});

describe("Expert queue", () => {
  it("lists waiting applications with the overdue wait and opens the review", async () => {
    mockApi({
      ...session,
      "GET /api/expert/queue": (_b, init) => {
        void init;
        return [queueItem()];
      },
      "GET /api/applications/7": () => reviewApp(),
      ...catalogRoutes,
    });
    renderApp("/expert");
    const row = await screen.findByRole("link", { name: /№ 10-482, Кольцо с камнем/ });
    expect(within(row).getByText(/Айгерим С\./)).toBeInTheDocument();
    expect(within(row).getByText("Ждёт").parentElement).toHaveAttribute("data-late");
    expect(screen.getByRole("radio", { name: /Ждут эксперта, 1/ })).toBeChecked();
    await userEvent.click(row);
    expect(await screen.findByRole("heading", { name: "Заявка № 10-482" })).toBeInTheDocument();
    expect(screen.getByTestId("location")).toHaveTextContent("/expert/applications/7");
  });

  it("shows an empty inspection queue", async () => {
    mockApi({ ...session, "GET /api/expert/queue": () => [] });
    renderApp("/expert/inspections");
    expect(await screen.findByText(/Доставленных изделий нет/)).toBeInTheDocument();
  });
});

describe("Expert review", () => {
  it("takes the application, calculates live and sends the offer", async () => {
    let app = reviewApp();
    const quotes: unknown[] = [];
    let sent: Record<string, unknown> | null = null;
    mockApi({
      ...session,
      ...catalogRoutes,
      "GET /api/expert/queue": () => [],
      "GET /api/applications/7": () => app,
      "POST /api/expert/applications/7/take": () => {
        app = reviewApp({
          status: "UNDER_REVIEW",
          status_label: "У эксперта",
          actions: ["send_offer", "request_info", "reject"],
        });
        return app;
      },
      "POST /api/expert/applications/7/quote": (body) => {
        quotes.push(body);
        return quote;
      },
      "POST /api/expert/applications/7/offer": (body) => {
        sent = body as Record<string, unknown>;
        app = reviewApp({ status: "OFFER_SENT", status_label: "Предложение", offer, actions: [] });
        return app;
      },
    });
    renderApp("/expert/applications/7");
    // галерея: миниатюра слабого снимка подписана замечанием анализа
    expect(
      await screen.findByRole("button", { name: "Фото 2, есть замечания" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Слишком тёмное")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Увеличить" }));
    expect(screen.getByText(/150/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Взять в работу" }));
    const value = await screen.findByLabelText("Рыночная стоимость");
    expect(value).toHaveValue("119 000");
    expect(screen.getByLabelText("Ставка")).toHaveValue("0,25");
    await waitFor(() => expect(quotes.length).toBeGreaterThan(0));
    expect(await screen.findByText("Клиент получит")).toBeInTheDocument();

    await userEvent.clear(screen.getByLabelText("Ставка"));
    await userEvent.type(screen.getByLabelText("Ставка"), "0,2");
    await userEvent.type(screen.getByLabelText("Комментарий клиенту"), "Клеймо совпадает");
    await waitFor(() => expect(quotes.at(-1)).toMatchObject({ daily_rate_bp: 20 }));
    await userEvent.click(screen.getByRole("button", { name: "Отправить предложение" }));
    await screen.findByRole("heading", { name: "Предложение у клиента" });
    expect(sent).toEqual({
      market_value: 11_900_000,
      ltv_percent: 80,
      daily_rate_bp: 20,
      term_days: 30,
      hallmark_confirmed: true,
      comment: "Клеймо совпадает",
    });
  });

  it("requires a comment to request photos", async () => {
    let body: unknown = null;
    mockApi({
      ...session,
      ...catalogRoutes,
      "GET /api/expert/queue": () => [],
      "GET /api/applications/7": () =>
        reviewApp({ status: "UNDER_REVIEW", actions: ["send_offer", "request_info", "reject"] }),
      "POST /api/expert/applications/7/quote": () => quote,
      "POST /api/expert/applications/7/need-info": (b) => {
        body = b;
        return reviewApp({ status: "NEED_INFO", status_label: "Нужны фото", actions: [] });
      },
    });
    renderApp("/expert/applications/7");
    await userEvent.click(await screen.findByRole("button", { name: "Запросить фото" }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "Отправить запрос" }));
    expect(within(dialog).getByText("Напишите, что нужно клиенту")).toBeInTheDocument();
    await userEvent.type(within(dialog).getByLabelText("Что нужно клиенту"), "Клеймо крупно");
    await userEvent.click(within(dialog).getByRole("button", { name: "Отправить запрос" }));
    await screen.findByRole("heading", { name: "Ждём ответа клиента" });
    expect(body).toEqual({ comment: "Клеймо крупно" });
  });

  it("confirms an inspection with a lower amount only with a comment", async () => {
    let body: Record<string, unknown> | null = null;
    const delivered = reviewApp({
      status: "ITEM_DELIVERED",
      status_label: "В ломбарде",
      offer: { ...offer, status: "ACCEPTED" },
      actions: ["inspect"],
    });
    mockApi({
      ...session,
      ...catalogRoutes,
      "GET /api/expert/queue": () => [],
      "GET /api/applications/7": () => delivered,
      "POST /api/expert/applications/7/inspection/quote": (b) => {
        const la = (b as { loan_amount: number }).loan_amount;
        if (la > offer.loan_amount)
          return new MockHttpError(422, {
            detail: "Проверьте результат осмотра",
            errors: [{ loc: ["body", "loan_amount"], msg: "Сумма больше согласованной" }],
          });
        return {
          market_value: 11_900_000,
          offer_loan_amount: offer.loan_amount,
          adjusted: la < offer.loan_amount,
          quote: { ...quote, loan_amount: la },
        };
      },
      "POST /api/expert/applications/7/inspection": (b) => {
        body = b as Record<string, unknown>;
        return { ...delivered, status: "INSPECTED", status_label: "Осмотрено", actions: [] };
      },
    });
    renderApp("/expert/applications/7");
    const amount = await screen.findByLabelText("Итоговая сумма займа");
    expect(amount).toHaveValue("95 200");
    await userEvent.clear(amount);
    await userEvent.type(amount, "90000");
    expect(await screen.findByText("Сумма меньше согласованной")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Подтвердить осмотр" }));
    expect(screen.getByText("Объясните клиенту, почему сумма изменилась")).toBeInTheDocument();
    expect(body).toBeNull();
    await userEvent.type(screen.getByLabelText(/Комментарий клиенту/), "Вес 4,0 г");
    await userEvent.click(screen.getByRole("button", { name: "Подтвердить осмотр" }));
    await screen.findByRole("heading", { name: "Осмотрено" });
    expect(body).toMatchObject({
      loan_amount: 9_000_000,
      market_value: 11_900_000,
      hallmark_confirmed: true,
      weight_g: 4.2,
      comment: "Вес 4,0 г",
    });
  });
});
