import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { setTokens } from "../../api/client";
import type { CourierTask } from "../../api/types";
import { todayKz } from "../../lib/time";
import { mockApi, renderApp, userFixture } from "../../test/utils";
import { stepLabel, taskSteps } from "./courierLib";

beforeEach(() => setTokens({ access: "a", refresh: "r" }));

const session = {
  "GET /api/auth/me": () => userFixture("COURIER"),
  "GET /api/notifications/unread-count": () => ({ unread: 0 }),
};

function task(over: Partial<CourierTask> = {}): CourierTask {
  return {
    id: 1,
    kind: "PICKUP",
    kind_label: "Забрать у клиента",
    status: "SCHEDULED",
    status_label: "Назначен",
    application: {
      id: 7,
      number: "10-482",
      title: "Кольцо",
      category_name: "Золото",
      status: "COURIER_SCHEDULED",
      status_label: "Курьер назначен",
    },
    client: { id: 1, full_name: "Айгерим Касымова", phone: "+77015552418", city: "Алматы" },
    courier: { id: 4, full_name: "Нурлан Жумабаев", phone: null, city: "Алматы" },
    city: "Алматы",
    address: "ул. Розыбакиева, 247, кв. 18",
    contact_phone: "+77015552418",
    contact_phone_display: "+7 701 555-24-18",
    slot_start: "2026-11-04T07:00:00Z",
    slot_end: "2026-11-04T09:00:00Z",
    slot_label: "04.11, 12:00–14:00",
    comment: "Подъезд 2, домофон 18",
    completed_at: null,
    created_at: "2026-11-03T10:00:00Z",
    updated_at: "2026-11-03T10:00:00Z",
    actions: ["start"],
    ...over,
  };
}

describe("courierLib", () => {
  it("builds steps and button labels for pickup and return", () => {
    expect(taskSteps(task({ status: "EN_ROUTE" })).map((s) => s.done)).toEqual([
      true,
      false,
      false,
    ]);
    expect(taskSteps(task({ kind: "RETURN" })).map((s) => s.label)).toEqual([
      "Выехал",
      "Передал клиенту",
    ]);
    expect(stepLabel(task(), "deliver")).toBe("Доставил в ломбард");
    expect(stepLabel(task({ kind: "RETURN" }), "deliver")).toBe("Передал клиенту");
  });
});

describe("Courier day", () => {
  it("shows today's progress, expands the first active trip and moves it forward", async () => {
    let current = task();
    const days: string[] = [];
    const posted: string[] = [];
    mockApi({
      ...session,
      "GET /api/courier/tasks": (_b, init) => {
        void init;
        return [
          current,
          task({
            id: 2,
            kind: "RETURN",
            kind_label: "Вернуть клиенту",
            address: "мкр. Самал-2, 58",
            slot_start: "2026-11-04T09:00:00Z",
            slot_end: "2026-11-04T11:00:00Z",
          }),
          task({
            id: 3,
            status: "DELIVERED",
            status_label: "Доставлено",
            actions: [],
            completed_at: "2026-11-04T05:00:00Z",
          }),
        ];
      },
      "POST /api/courier/tasks/1/start": () => {
        posted.push("start");
        current = task({ status: "EN_ROUTE", status_label: "В пути", actions: ["pick_up"] });
        return current;
      },
    });
    const fetchMock = globalThis.fetch as unknown as { mock: { calls: [string][] } };
    renderApp("/courier");
    expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent(/^Сегодня,/);
    expect(await screen.findByText("1 из 3 выездов выполнено")).toBeInTheDocument();
    for (const [url] of fetchMock.mock.calls) if (url.includes("/courier/tasks")) days.push(url);
    expect(days[0]).toContain(`scope=day&day=${todayKz()}`);

    const card = screen.getByRole("article", { name: /Забрать изделие/ });
    expect(within(card).getByRole("link", { name: /Позвонить/ })).toHaveAttribute(
      "href",
      "tel:+77015552418",
    );
    await userEvent.click(within(card).getByRole("button", { name: "Выехал к клиенту" }));
    expect(await screen.findByRole("button", { name: "Изделие у меня" })).toBeInTheDocument();
    expect(posted).toEqual(["start"]);

    // второй выезд свёрнут — раскрывается по нажатию
    await userEvent.click(screen.getByRole("button", { name: /Вернуть изделие/ }));
    expect(await screen.findByRole("button", { name: "Выехал с изделием" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("radio", { name: "Выполненные, 1" }));
    expect(screen.getByText(/10:00/)).toBeInTheDocument();
  });

  it("switches days and shows an empty day", async () => {
    mockApi({ ...session, "GET /api/courier/tasks": () => [] });
    renderApp("/courier");
    expect(await screen.findByText(/На этот день выездов нет/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Следующий день" }));
    expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent(/^Завтра,/);
  });
});
