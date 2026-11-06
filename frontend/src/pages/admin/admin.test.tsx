import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { setTokens } from "../../api/client";
import type { CourierLoad, CourierTask, Loan, MetalPrice, Stats } from "../../api/types";
import { mockApi, renderApp, userFixture } from "../../test/utils";
import {
  autoAssignPlan,
  formatTengeCompact,
  issuedByDay,
  metalRows,
  overdueShare,
  stageCounts,
} from "./adminLib";

beforeEach(() => setTokens({ access: "a", refresh: "r" }));

const session = {
  "GET /api/auth/me": () => ({ ...userFixture("ADMIN"), id: 9 }),
  "GET /api/notifications/unread-count": () => ({ unread: 0 }),
};

const stats: Stats = {
  now: "2026-11-04T10:00:00Z",
  applications_total: 20,
  by_status: { PRE_ESTIMATED: 4, UNDER_REVIEW: 2, OFFER_SENT: 1, LOAN_ACTIVE: 3, OVERDUE: 1 },
  funnel: { draft: 0, review: 7, logistics: 0, loans: 4, closed: 6, declined: 3 },
  loans_active: 3,
  loans_overdue: 1,
  loans_repaid: 5,
  loans_forfeited: 1,
  loans_due_soon: 2,
  portfolio_principal: 1_840_000_000,
  accrued_interest: 12_000_000,
  issued_total: 4_170_000_000,
  repaid_total: 0,
  interest_income: 0,
  failed_payments: 0,
  users_by_role: {},
  couriers_open_tasks: 1,
  courier_tasks_today: 1,
};

const loan = (issued: string, principal: number) => ({ issued_at: issued, principal }) as Loan;

const courier = (id: number, city: string, open: number): CourierLoad => ({
  courier: { id, full_name: `Курьер ${id}`, phone: null, city },
  open_tasks: open,
  today_tasks: 0,
});

const task = (id: number, city: string, over: Partial<CourierTask> = {}) =>
  ({
    id,
    kind: "PICKUP",
    status: "SCHEDULED",
    status_label: "Назначен",
    application: { id, number: `10-${id}`, title: "Кольцо" },
    courier: null,
    city,
    address: "пр. Достык, 105",
    slot_start: "2026-11-05T11:00:00Z",
    slot_end: "2026-11-05T13:00:00Z",
    actions: ["assign"],
    ...over,
  }) as CourierTask;

const price = (id: number, metal: MetalPrice["metal"], p: number, at: string, current = false) => ({
  id,
  metal,
  price_per_gram: p,
  effective_from: at,
  source: "manual",
  is_current: current,
});

describe("adminLib", () => {
  it("groups issued loans by Kazakhstan day", () => {
    const b = issuedByDay(
      [
        loan("2026-11-03T20:00:00Z", 100), // 4 ноября по Алматы
        loan("2026-11-04T05:00:00Z", 50),
        loan("2026-10-01T05:00:00Z", 999),
      ],
      "2026-11-04",
      7,
    );
    expect(b).toHaveLength(7);
    expect(b[6]).toEqual({ date: "2026-11-04", amount: 150, count: 2 });
    expect(b[0]!.date).toBe("2026-10-29");
  });

  it("formats compact sums, stages and overdue share", () => {
    expect(formatTengeCompact(1_840_000_000)).toBe("18,4 млн ₸");
    expect(formatTengeCompact(9_500_000)).toBe("95 тыс. ₸");
    expect(stageCounts(stats).find((s) => s.label === "Займ действует")?.count).toBe(4);
    expect(overdueShare(stats)).toBe(25);
  });

  it("plans auto-assignment to the least loaded courier of the city", () => {
    const plan = autoAssignPlan(
      [task(1, "Алматы"), task(2, "Алматы"), task(3, "Астана"), task(4, "Шымкент")],
      [courier(1, "Алматы", 2), courier(2, "Алматы", 1), courier(3, "Астана", 0)],
    );
    expect(plan).toEqual([
      { taskId: 1, courierId: 2 },
      { taskId: 2, courierId: 1 }, // загрузка сравнялась (2 и 2) — первый по списку
      { taskId: 3, courierId: 3 },
    ]);
  });

  it("computes the price change to the previous record", () => {
    const rows = metalRows([
      price(1, "GOLD", 6_650_000, "2026-11-01T00:00:00Z"),
      price(2, "GOLD", 6_690_000, "2026-11-04T00:00:00Z", true),
      price(3, "SILVER", 82_000, "2026-11-01T00:00:00Z", true),
    ]);
    expect(rows.map((r) => r.metal)).toEqual(["GOLD", "SILVER"]);
    expect(rows[0]!.change).toBeCloseTo(0.6, 1);
    expect(rows[1]!.change).toBeNull();
  });
});

describe("Admin dashboard", () => {
  it("shows tiles, the chart, stages and assigns a courier", async () => {
    const assigned: unknown[] = [];
    mockApi({
      ...session,
      "GET /api/admin/stats": () => stats,
      "GET /api/loans": () => [loan("2026-11-04T05:00:00Z", 9_520_000)],
      "GET /api/admin/courier-tasks": () => [task(1, "Алматы")],
      "GET /api/admin/couriers": () => [courier(4, "Алматы", 3)],
      "GET /api/admin/metal-prices": () => [
        price(1, "GOLD", 6_650_000, "2026-11-01T00:00:00Z", true),
      ],
      "GET /api/admin/clock": () => ({
        now: stats.now,
        offset_seconds: 0,
        offset_days: 0,
        enabled: true,
      }),
      "POST /api/admin/courier-tasks/1/assign": (b) => {
        assigned.push(b);
        return task(1, "Алматы", { courier: courier(4, "Алматы", 3).courier, actions: [] });
      },
      "POST /api/admin/clock": (b) => ({
        now: "2026-11-11T10:00:00Z",
        offset_seconds: 604800,
        offset_days: 7,
        enabled: true,
        jobs: {
          now: "",
          offers_expired: 0,
          loans_overdue: (b as { days: number }).days,
          loans_forfeited: 0,
        },
      }),
    });
    renderApp("/admin");
    expect(await screen.findByRole("heading", { name: "Обзор" })).toBeInTheDocument();
    expect(screen.getByText(/^25\s%$/)).toBeInTheDocument();
    expect(screen.getByText(/^Портфель 18,4\sмлн\s₸$/)).toBeInTheDocument();
    expect(await screen.findByRole("group", { name: /Выдано займов по дням/ })).toBeInTheDocument();

    await userEvent.click(await screen.findByRole("button", { name: "Назначить автоматически" }));
    await waitFor(() => expect(assigned).toEqual([{ courier_id: 4 }]));

    await userEvent.click(screen.getByRole("button", { name: "+7 дней" }));
    expect(await screen.findByText(/^Время перемотано на 7\sдней$/)).toBeInTheDocument();
  });
});

describe("Admin catalog and users", () => {
  it("edits a category and validates terms", async () => {
    let patch: unknown = null;
    const cat = {
      id: 1,
      code: "gold",
      name: "Золото",
      description: null,
      ltv_percent: 80,
      daily_rate_bp: 25,
      min_term_days: 7,
      max_term_days: 60,
      requires_metal: true,
      sort_order: 1,
      is_active: true,
    };
    mockApi({
      ...session,
      "GET /api/admin/categories": () => [cat],
      "GET /api/admin/metal-prices": () => [],
      "PATCH /api/admin/categories/1": (b) => {
        patch = b;
        return { ...cat, ...(b as object) };
      },
    });
    renderApp("/admin/catalog");
    await userEvent.click(
      await screen.findByRole("button", { name: "Изменить категорию «Золото»" }),
    );
    const dialog = await screen.findByRole("dialog");
    const max = within(dialog).getByLabelText("Срок до");
    await userEvent.clear(max);
    await userEvent.type(max, "5");
    await userEvent.click(within(dialog).getByRole("button", { name: "Сохранить" }));
    expect(within(dialog).getByText("Не меньше минимального")).toBeInTheDocument();
    await userEvent.type(max, "0");
    const rate = within(dialog).getByLabelText("Ставка");
    await userEvent.clear(rate);
    await userEvent.type(rate, "0,3");
    await userEvent.click(within(dialog).getByRole("button", { name: "Сохранить" }));
    await waitFor(() =>
      expect(patch).toEqual({
        name: "Золото",
        ltv_percent: 80,
        daily_rate_bp: 30,
        min_term_days: 7,
        max_term_days: 50,
        is_active: true,
      }),
    );
  });

  it("changes a role and blocks a user, but not the admin themself", async () => {
    const patches: unknown[] = [];
    const users = [
      { ...userFixture("ADMIN"), id: 9, full_name: "Гульнара Беккожина" },
      { ...userFixture("CLIENT"), id: 2 },
    ];
    mockApi({
      ...session,
      "GET /api/admin/users": () => users,
      "PATCH /api/admin/users/2": (b) => {
        patches.push(b);
        return { ...users[1], ...(b as object) };
      },
    });
    renderApp("/admin/users");
    expect(
      await screen.findByRole("combobox", { name: "Роль: Гульнара Беккожина" }),
    ).toBeDisabled();
    expect(screen.queryByRole("button", { name: /Заблокировать: Гульнара/ })).toBeNull();
    await userEvent.selectOptions(
      screen.getByRole("combobox", { name: "Роль: Айгерим Садыкова" }),
      "EXPERT",
    );
    await userEvent.click(screen.getByRole("button", { name: "Заблокировать: Айгерим Садыкова" }));
    await waitFor(() => expect(patches).toEqual([{ role: "EXPERT" }, { is_active: false }]));
  });
});
