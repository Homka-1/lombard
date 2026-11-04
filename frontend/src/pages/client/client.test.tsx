import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { setTokens } from "../../api/client";
import type { Application, ApplicationListItem, Loan, Offer, Slot } from "../../api/types";
import { MockHttpError, catalogRoutes, mockApi, renderApp, userFixture } from "../../test/utils";
import {
  buildTimeline,
  formatCardInput,
  formatDateTimeKz,
  formatSlotDay,
  formatTimeKz,
  isCardValid,
} from "./clientLib";

// Testing Library нормализует неразрывные пробелы в тексте, но не в доступных именах:
// для кнопок с суммами — регулярное выражение, где пробел означает любой пробельный символ.
const named = (s: string) =>
  new RegExp(`^${s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ /g, "\\s")}$`);

const session = {
  "GET /api/auth/me": () => userFixture("CLIENT"),
  "GET /api/notifications/unread-count": () => ({ unread: 0 }),
};

const quote = {
  loan_amount: 9_520_000,
  daily_rate_bp: 20,
  rate_label: "0,2 % в день",
  annual_rate_percent: 73,
  term_days: 30,
  interest: 571_200,
  total_to_repay: 10_091_200,
  start_date: "2026-11-04",
  due_date: "2026-12-04",
  grace_until: "2027-01-03",
  schedule: [],
};

const offer: Offer = {
  id: 1,
  status: "SENT",
  status_label: "Отправлено",
  market_value: 11_900_000,
  value_min: 11_200_000,
  value_max: 12_700_000,
  ltv_percent: 80,
  hallmark_confirmed: true,
  loan_amount: 9_520_000,
  daily_rate_bp: 20,
  rate_label: "0,2 % в день",
  term_days: 30,
  interest: 571_200,
  total_to_repay: 10_091_200,
  comment: "Клеймо и вес совпадают с описанием.",
  expert: { id: 3, full_name: "Ерлан Касымов", phone: null, city: "Алматы" },
  expires_at: "2026-11-07T10:05:00Z",
  decided_at: null,
  created_at: "2026-11-04T10:05:00Z",
  quote,
};

const photo = (id: number, score = 80) => ({
  id,
  position: id,
  original_name: `p${id}.jpg`,
  content_type: "image/jpeg",
  size_bytes: 1000,
  width: 1200,
  height: 1200,
  quality_score: score,
  url: `/api/photos/${id}`,
  thumb_url: `/api/photos/${id}/thumb`,
  created_at: "2026-11-04T09:40:00Z",
});

function appFixture(over: Partial<Application> = {}): Application {
  return {
    id: 7,
    number: "10-482",
    client_id: 1,
    status: "DRAFT",
    status_label: "Черновик",
    category: { id: 1, code: "gold", name: "Золото", requires_metal: true, ltv_percent: 80 },
    title: "Кольцо с камнем",
    description: null,
    metal: "GOLD",
    fineness: 585,
    weight_g: 4.2,
    brand: null,
    condition: "GOOD",
    requested_amount: null,
    created_at: "2026-11-04T09:30:00Z",
    updated_at: "2026-11-04T09:32:00Z",
    submitted_at: null,
    editable: true,
    can_submit: true,
    max_photos: 6,
    photos: [],
    pre_estimate: null,
    client: { id: 1, full_name: "Айгерим Садыкова", phone: "+77011234567", city: "Алматы" },
    expert: null,
    expert_appraisal: null,
    offer: null,
    courier_visit: null,
    inspection: null,
    loan: null,
    actions: ["edit", "submit", "delete"],
    history: [
      {
        id: 1,
        from_status: null,
        to_status: "DRAFT",
        to_status_label: "Черновик",
        actor_role: "CLIENT",
        comment: null,
        created_at: "2026-11-04T09:30:00Z",
      },
    ],
    ...over,
  };
}

const hist = (
  id: number,
  to: Application["status"],
  label: string,
  at: string,
  comment: string | null = null,
) => ({
  id,
  from_status: null,
  to_status: to,
  to_status_label: label,
  actor_role: "EXPERT" as const,
  comment,
  created_at: at,
});

const offerApp = () =>
  appFixture({
    status: "OFFER_SENT",
    status_label: "Предложение",
    editable: false,
    photos: [photo(1), photo(2)],
    pre_estimate: {
      id: 1,
      kind: "AUTO",
      value_min: 11_200_000,
      value_max: 12_700_000,
      value: 12_000_000,
      confidence: 92,
      comment: null,
      details: null,
      created_at: "2026-11-04T09:40:00Z",
    },
    offer,
    expert: offer.expert,
    actions: ["accept_offer", "decline_offer"],
    history: [
      hist(2, "SUBMITTED", "Отправлена", "2026-11-04T09:40:00Z"),
      hist(3, "PRE_ESTIMATED", "Предоценка готова", "2026-11-04T09:40:01Z"),
      hist(4, "UNDER_REVIEW", "У эксперта", "2026-11-04T09:52:00Z"),
      hist(5, "OFFER_SENT", "Предложение", "2026-11-04T10:05:00Z", "служебный расчёт"),
    ],
  });

const slots: Slot[] = [
  {
    start: "2026-11-05T05:00:00Z",
    end: "2026-11-05T07:00:00Z",
    date: "2026-11-05",
    label: "05.11, 10:00–12:00",
    capacity: 3,
    free: 0,
    available: false,
  },
  {
    start: "2026-11-05T07:00:00Z",
    end: "2026-11-05T09:00:00Z",
    date: "2026-11-05",
    label: "05.11, 12:00–14:00",
    capacity: 3,
    free: 2,
    available: true,
  },
];

function loanFixture(over: Partial<Loan> = {}): Loan {
  return {
    id: 5,
    ticket_number: "ЗБ-2026-000005",
    status: "ACTIVE",
    status_label: "Действует",
    principal: 9_520_000,
    daily_rate_bp: 20,
    rate_label: "0,2 % в день",
    issued_at: "2026-11-04T10:00:00Z",
    due_date: "2026-12-04",
    grace_until: "2027-01-03",
    days_used: 3,
    accrued_interest: 57_120,
    total_to_repay: 9_577_120,
    days_left: 27,
    overdue_days: 0,
    grace_days_left: 30,
    due_soon: false,
    extensions_count: 0,
    closed_at: null,
    ticket_url: "/api/loans/5/ticket",
    application: {
      id: 7,
      number: "10-482",
      title: "Кольцо с камнем",
      category_name: "Золото",
      status: "LOAN_ACTIVE",
      status_label: "Займ действует",
    },
    client: { id: 1, full_name: "Айгерим Садыкова", phone: null, city: "Алматы" },
    term_days: 30,
    due_at: "2026-12-04T18:59:59Z",
    interest_from: "2026-11-04T10:00:00Z",
    total_at_due: 10_091_200,
    extensions_left: 5,
    extension: null,
    payments: [
      {
        id: 1,
        kind: "DISBURSEMENT",
        kind_label: "Выдача займа",
        status: "SUCCEEDED",
        status_label: "Проведён",
        amount: 9_520_000,
        destination: "4400 43** **** 6789",
        provider_ref: "x",
        created_at: "2026-11-04T10:00:00Z",
      },
    ],
    actions: ["repay", "extend"],
    now: "2026-11-07T10:00:00Z",
    ...over,
  };
}

beforeEach(() => setTokens({ access: "a", refresh: "r" }));

// ---------------------------------------------------------------------------------------

describe("clientLib", () => {
  it("formats Kazakhstan time (UTC+5) and slot days", () => {
    expect(formatTimeKz("2026-11-04T09:40:00Z")).toBe("14:40");
    expect(formatDateTimeKz("2026-11-04T20:10:00Z")).toBe("5 ноября, 01:10");
    expect(formatSlotDay("2026-11-05")).toBe("Чт, 5 ноября");
  });

  it("masks and validates card numbers with the Luhn check", () => {
    expect(formatCardInput("4400430123456789")).toBe("4400 4301 2345 6789");
    expect(formatCardInput("44a00")).toBe("4400");
    expect(isCardValid("4400 4301 2345 6789")).toBe(true);
    expect(isCardValid("4400 4301 2345 6788")).toBe(false);
    expect(isCardValid("4400")).toBe(false);
  });

  it("builds the timeline: history done, current step, milestones ahead", () => {
    const items = buildTimeline(offerApp());
    expect(items.map((i) => [i.label, i.state])).toEqual([
      ["Отправлена", "done"],
      ["Предоценка готова", "done"],
      ["У эксперта", "done"],
      ["Предложение", "current"],
      ["Курьер забирает изделие", "todo"],
      ["Осмотр в ломбарде", "todo"],
      ["Деньги на карту", "todo"],
      ["Погашение займа", "todo"],
      ["Изделие у вас", "todo"],
    ]);
    // служебные комментарии в таймлайн не попадают
    expect(items[3]!.comment).toBeNull();
  });

  it("ends the timeline at a final status", () => {
    const app = appFixture({
      status: "REJECTED",
      history: [
        hist(2, "SUBMITTED", "Отправлена", "2026-11-04T09:40:00Z"),
        hist(3, "REJECTED", "Отклонена", "2026-11-04T10:00:00Z", "Изделие не принимаем"),
      ],
    });
    const items = buildTimeline(app);
    expect(items.map((i) => i.state)).toEqual(["done", "done"]);
    expect(items[1]!.comment).toBe("Изделие не принимаем");
  });
});

describe("Applications list", () => {
  const items: ApplicationListItem[] = [
    {
      id: 7,
      number: "10-482",
      status: "OFFER_SENT",
      status_label: "Предложение",
      title: "Кольцо с камнем",
      category: { id: 1, code: "gold", name: "Золото", requires_metal: true, ltv_percent: 80 },
      photo_count: 4,
      cover_thumb_url: "/api/photos/1/thumb",
      pre_estimate_min: 11_200_000,
      pre_estimate_max: 12_700_000,
      created_at: "2026-11-03T09:30:00Z",
      submitted_at: "2026-11-03T09:40:00Z",
      updated_at: "2026-11-03T10:05:00Z",
    },
    {
      id: 3,
      number: "10-301",
      status: "ITEM_RETURNED",
      status_label: "Изделие возвращено",
      title: "Часы Seiko",
      category: { id: 4, code: "watches", name: "Часы", requires_metal: false, ltv_percent: 60 },
      photo_count: 2,
      cover_thumb_url: null,
      pre_estimate_min: null,
      pre_estimate_max: null,
      created_at: "2026-10-01T09:30:00Z",
      submitted_at: null,
      updated_at: "2026-10-20T10:05:00Z",
    },
  ];

  it("shows active applications first and filters closed ones", async () => {
    mockApi({ ...session, "GET /api/applications": () => items });
    renderApp("/client");
    const link = await screen.findByRole("link", { name: /Кольцо с камнем/ });
    expect(link).toHaveAttribute("href", "/client/applications/7");
    expect(within(link).getByText("Нужно ваше действие")).toBeInTheDocument();
    expect(within(link).getByText("112 000 – 127 000 ₸")).toBeInTheDocument();
    expect(screen.queryByText("Часы Seiko")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("radio", { name: "Завершённые" }));
    expect(screen.getByText("Часы Seiko")).toBeInTheDocument();
    expect(screen.queryByText("Кольцо с камнем")).not.toBeInTheDocument();
  });

  it("invites to create the first application", async () => {
    mockApi({ ...session, "GET /api/applications": () => [] });
    renderApp("/client");
    expect(await screen.findByRole("heading", { name: "Заявок пока нет" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Оценить изделие" })).toHaveAttribute(
      "href",
      "/client/new",
    );
  });
});

describe("Application wizard", () => {
  it("validates, creates a draft, uploads photos and submits", async () => {
    let created: Record<string, unknown> | null = null;
    let current = appFixture();
    const fetch = mockApi({
      ...session,
      ...catalogRoutes,
      "POST /api/applications": (body) => {
        created = body as Record<string, unknown>;
        return current;
      },
      "POST /api/applications/7/photos": () => {
        current = { ...current, photos: [photo(1), photo(2, 30)] };
        return current;
      },
      "POST /api/applications/7/submit": () => ({
        ...offerApp(),
        status: "PRE_ESTIMATED",
        offer: null,
        actions: [],
      }),
      "GET /api/applications/7": () => ({
        ...offerApp(),
        status: "PRE_ESTIMATED",
        offer: null,
        actions: [],
      }),
      "GET /api/applications": () => [],
    });
    renderApp("/client/new");

    await userEvent.click(await screen.findByRole("button", { name: "Далее" }));
    expect(screen.getByText("Выберите, что вы хотите заложить")).toBeInTheDocument();
    expect(screen.getByText("Назовите изделие — так его узнает эксперт")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("radio", { name: /^Золото/ }));
    await userEvent.type(screen.getByLabelText("Название изделия"), "Кольцо с камнем");
    await userEvent.click(screen.getByRole("button", { name: "Далее" }));

    // параметры: обязательны проба, вес и состояние
    await userEvent.click(screen.getByRole("button", { name: "Далее" }));
    expect(screen.getByText("Укажите пробу — она выбита на клейме")).toBeInTheDocument();
    await userEvent.selectOptions(await screen.findByLabelText("Проба"), "585");
    await userEvent.type(screen.getByLabelText("Вес"), "4,2");
    await userEvent.selectOptions(screen.getByLabelText("Состояние"), "GOOD");
    await userEvent.type(screen.getByLabelText("Желаемая сумма займа"), "80000");
    await userEvent.click(screen.getByRole("button", { name: "Далее" }));

    await screen.findByRole("heading", { name: "Фотографии изделия" });
    expect(created).toMatchObject({
      category_id: 1,
      title: "Кольцо с камнем",
      metal: "GOLD",
      fineness: 585,
      weight_g: 4.2,
      condition: "GOOD",
      requested_amount: 8_000_000,
    });
    expect(screen.getByRole("button", { name: "Перейти к проверке" })).toBeDisabled();

    const file = new File(["x"], "ring.jpg", { type: "image/jpeg" });
    fireEvent.change(screen.getByTestId("photo-input"), { target: { files: [file] } });
    expect(await screen.findByText("Обложка заявки")).toBeInTheDocument();
    // снимок с низкой оценкой качества — предупреждение с кнопкой «Переснять»
    expect(screen.getByText("Фото 2 получилось нечётким или тёмным")).toBeInTheDocument();
    const upload = fetch.mock.calls.find(([url]) => String(url).endsWith("/photos"));
    expect(upload![1]!.body).toBeInstanceOf(FormData);

    await userEvent.click(screen.getByRole("button", { name: "Перейти к проверке" }));
    expect(screen.getByRole("heading", { name: "Проверьте заявку" })).toBeInTheDocument();
    expect(screen.getAllByText("80 000 ₸").length).toBeGreaterThan(0);
    await userEvent.click(screen.getByRole("button", { name: "Отправить на оценку" }));
    await waitFor(() =>
      expect(screen.getByTestId("location")).toHaveTextContent("/client/applications/7"),
    );
  });

  it("opens an existing draft on the photo step and shows submit problems", async () => {
    mockApi({
      ...session,
      ...catalogRoutes,
      "GET /api/applications/7": () => appFixture({ photos: [photo(1)] }),
      "POST /api/applications/7/submit": () =>
        new MockHttpError(422, {
          detail: [{ loc: ["body", "condition"], msg: "Укажите состояние изделия" }],
          message: "Заявку пока нельзя отправить",
        }),
    });
    renderApp("/client/new?draft=7");
    expect(await screen.findByRole("heading", { name: "Фотографии изделия" })).toBeInTheDocument();
    expect(screen.getByText(/Черновик сохранён в 14:32/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Перейти к проверке" }));
    await userEvent.click(screen.getByRole("button", { name: "Отправить на оценку" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Заявку пока нельзя отправить");
    expect(alert).toHaveTextContent("Укажите состояние изделия");
    await userEvent.click(within(alert).getByRole("button", { name: "Исправить" }));
    expect(screen.getByRole("heading", { name: "Параметры изделия" })).toBeInTheDocument();
  });
});

describe("Application card", () => {
  it("shows the offer, accepts it and calls a courier", async () => {
    let visit: Record<string, unknown> | null = null;
    const accepted = {
      ...offerApp(),
      status: "OFFER_ACCEPTED" as const,
      offer: { ...offer, status: "ACCEPTED" as const },
      actions: ["schedule_courier" as const],
    };
    mockApi({
      ...session,
      "GET /api/applications/7": () => offerApp(),
      "POST /api/applications/7/offer/accept": () => accepted,
      "GET /api/delivery/cities": () => [{ city: "Алматы", couriers: 2 }],
      "GET /api/delivery/slots": () => slots,
      "POST /api/applications/7/courier": (body) => {
        visit = body as Record<string, unknown>;
        return {
          ...accepted,
          status: "COURIER_SCHEDULED",
          actions: ["reschedule_courier"],
          courier_visit: {
            id: 1,
            kind: "PICKUP",
            kind_label: "Забрать",
            status: "SCHEDULED",
            status_label: "Назначен",
            courier: null,
            city: "Алматы",
            address: "ул. Розыбакиева, 247, кв. 18",
            contact_phone: "+77011234567",
            contact_phone_display: "+7 701 123-45-67",
            slot_start: slots[1]!.start,
            slot_end: slots[1]!.end,
            slot_label: slots[1]!.label,
            comment: null,
            completed_at: null,
          },
        };
      },
      "GET /api/applications": () => [],
    });
    renderApp("/client/applications/7");

    expect(await screen.findByRole("heading", { name: "Кольцо с камнем" })).toBeInTheDocument();
    expect(screen.getByText("Заявка № 10-482 от 4 ноября, золото 585, 4,2 г")).toBeInTheDocument();
    expect(screen.getByText("95 200 ₸")).toBeInTheDocument();
    expect(screen.getByText("100 912 ₸")).toBeInTheDocument();
    expect(screen.getByText("Действует до 7 ноября, 15:05")).toBeInTheDocument();
    expect(screen.getByText("Клеймо и вес совпадают с описанием.")).toBeInTheDocument();
    expect(screen.getByText("112 000 – 127 000 ₸")).toBeInTheDocument();
    expect(screen.getByRole("meter", { name: "Уверенность оценки" })).toHaveAttribute(
      "aria-valuenow",
      "92",
    );
    expect(screen.getByText("Примите или откажитесь до 7 ноября")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Принять и вызвать курьера" }));
    expect(await screen.findByRole("heading", { name: "Вызов курьера" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Принять и вызвать курьера" })).toBeNull();

    // занятый интервал недоступен, свободный — выбираем
    expect(await screen.findByRole("radio", { name: "Занято" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Вызвать курьера" }));
    expect(screen.getByText("Укажите улицу, дом и квартиру")).toBeInTheDocument();
    expect(screen.getByText("Выберите удобный интервал")).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText("Адрес"), "ул. Розыбакиева, 247, кв. 18");
    await userEvent.click(screen.getByRole("radio", { name: "12:00–14:00" }));
    expect(screen.getByLabelText("Телефон для курьера")).toHaveValue("+7 701 123-45-67");
    await userEvent.click(screen.getByRole("button", { name: "Вызвать курьера" }));

    expect(
      await screen.findByRole("heading", { name: "Курьер заберёт изделие" }),
    ).toBeInTheDocument();
    expect(visit).toMatchObject({
      city: "Алматы",
      address: "ул. Розыбакиева, 247, кв. 18",
      slot_start: slots[1]!.start,
      contact_phone: "+7 701 123-45-67",
    });
    expect(screen.getByText("5 ноября, 12:00–14:00")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Перенести визит" })).toBeInTheDocument();
  });

  it("declines the offer with a reason", async () => {
    let reason: unknown;
    mockApi({
      ...session,
      "GET /api/applications/7": () => offerApp(),
      "POST /api/applications/7/offer/decline": (body) => {
        reason = body;
        return {
          ...offerApp(),
          status: "OFFER_DECLINED",
          offer: { ...offer, status: "DECLINED" },
          actions: [],
        };
      },
      "GET /api/applications": () => [],
    });
    renderApp("/client/applications/7");
    await userEvent.click(await screen.findByRole("button", { name: "Отказаться" }));
    const dialog = screen.getByRole("dialog", { name: "Отказаться от предложения?" });
    await userEvent.type(within(dialog).getByLabelText(/Причина/), "Мало");
    await userEvent.click(within(dialog).getByRole("button", { name: "Отказаться" }));
    expect(
      await screen.findByRole("heading", { name: "Вы отказались от предложения" }),
    ).toBeInTheDocument();
    expect(reason).toEqual({ reason: "Мало" });
  });

  it("pays out after the inspection and validates the card number", async () => {
    let card: unknown;
    const inspected = appFixture({
      status: "INSPECTED",
      editable: false,
      offer: { ...offer, status: "ACCEPTED" },
      inspection: {
        id: 9,
        kind: "INSPECTION",
        value_min: 10_000_000,
        value_max: 10_000_000,
        value: 10_000_000,
        confidence: 100,
        comment: "Проба подтверждена",
        details: { loan_amount: 8_000_000 },
        created_at: "2026-11-05T08:00:00Z",
      },
      actions: ["issue_funds"],
    });
    mockApi({
      ...session,
      "GET /api/applications/7": () => inspected,
      "POST /api/applications/7/payout": (body) => {
        card = body;
        return new MockHttpError(402, { detail: "Банк отклонил перевод: карта заблокирована" });
      },
    });
    renderApp("/client/applications/7");
    expect(await screen.findByText("Сумма изменилась после осмотра")).toBeInTheDocument();
    const field = screen.getByLabelText("Карта для зачисления");
    await userEvent.type(field, "4400430123456788");
    await userEvent.click(screen.getByRole("button", { name: named("Получить 80 000 ₸") }));
    expect(screen.getByText("Проверьте номер карты — в нём ошибка")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "4400 4301 2345 6789" }));
    expect(field).toHaveValue("4400 4301 2345 6789");
    await userEvent.click(screen.getByRole("button", { name: named("Получить 80 000 ₸") }));
    expect(
      await screen.findByText("Банк отклонил перевод: карта заблокирована"),
    ).toBeInTheDocument();
    expect(card).toEqual({ card_number: "4400430123456789" });
  });

  it("deletes a draft after confirmation", async () => {
    let deleted = false;
    mockApi({
      ...session,
      "GET /api/applications/7": () => appFixture(),
      "DELETE /api/applications/7": () => {
        deleted = true;
        return {};
      },
      "GET /api/applications": () => [],
    });
    renderApp("/client/applications/7");
    expect(await screen.findByRole("link", { name: "Продолжить заполнение" })).toHaveAttribute(
      "href",
      "/client/new?draft=7",
    );
    await userEvent.click(screen.getByRole("button", { name: "Удалить черновик" }));
    await userEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Удалить" }),
    );
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent(/^\/client$/));
    expect(deleted).toBe(true);
  });
});

describe("Loans", () => {
  it("lists loans and repays one", async () => {
    let paid: unknown;
    mockApi({
      ...session,
      "GET /api/loans": () => [loanFixture()],
      "GET /api/loans/5": () => loanFixture(),
      "POST /api/loans/5/repay": (body) => {
        paid = body;
        return loanFixture({
          status: "REPAID",
          status_label: "Погашен",
          actions: [],
          closed_at: "2026-11-07T10:00:00Z",
        });
      },
      "GET /api/applications": () => [],
    });
    renderApp("/client/loans");
    const row = await screen.findByRole("link", { name: /Кольцо с камнем/ });
    expect(within(row).getByText("95 771,20 ₸")).toBeInTheDocument();
    expect(within(row).getByText(/Вернуть до 4 декабря, 27 дней осталось/)).toBeInTheDocument();

    await userEvent.click(row);
    await userEvent.click(
      await screen.findByRole("button", { name: named("Погасить 95 771,20 ₸") }),
    );
    const dialog = screen.getByRole("dialog", { name: "Погасить займ" });
    await userEvent.click(within(dialog).getByRole("button", { name: "4400 4301 2345 6789" }));
    await userEvent.click(
      within(dialog).getByRole("button", { name: named("Оплатить 95 771,20 ₸") }),
    );
    expect(await screen.findByText(/Вызовите курьера, чтобы вернуть изделие/)).toBeInTheDocument();
    expect(paid).toEqual({ card_number: "4400430123456789" });
  });

  it("quotes and pays an extension", async () => {
    let extended: unknown;
    mockApi({
      ...session,
      "GET /api/loans/5": () => loanFixture(),
      "GET /api/loans/5/extension": () => ({
        term_days: 30,
        pay_now: 57_120,
        days_used: 3,
        new_due_date: "2026-12-07",
        total_at_new_due: 10_091_200,
        extensions_left: 4,
      }),
      "POST /api/loans/5/extend": (body) => {
        extended = body;
        return loanFixture({ due_date: "2026-12-07", extensions_count: 1 });
      },
      "GET /api/loans": () => [],
      "GET /api/applications": () => [],
    });
    renderApp("/client/loans/5");
    await userEvent.click(await screen.findByRole("button", { name: "Продлить" }));
    const dialog = screen.getByRole("dialog", { name: "Продлить займ" });
    expect(await within(dialog).findByText("7 декабря")).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button", { name: "4400 4301 2345 6789" }));
    await userEvent.click(within(dialog).getByRole("button", { name: named("Оплатить 571,20 ₸") }));
    await waitFor(() =>
      expect(extended).toEqual({ card_number: "4400430123456789", term_days: 30 }),
    );
  });

  it("explains an empty list", async () => {
    mockApi({ ...session, "GET /api/loans": () => [] });
    renderApp("/client/loans");
    expect(await screen.findByRole("heading", { name: "Займов пока нет" })).toBeInTheDocument();
  });
});
