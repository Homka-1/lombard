/**
 * Мок-бэкенд демо-версии (`demo-src/mock-api.js`): формулы совпадают с backend
 * (эталон — `parity.fixture.json`, его пишет `backend/scripts/demo_parity_fixture.py`),
 * а API отвечает тем же контрактом: коды, тексты ошибок, откат при ошибке.
 * Сквозной сценарий с фото и всеми ролями — в `e2e/smoke.demo.ts` (Playwright, file://).
 */
import code from "../../demo-src/mock-api.js?raw";
import fixture from "./parity.fixture.json";

interface Reply {
  status: number;
  body: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  html?: string;
}
interface Demo {
  ready: () => Promise<void>;
  reset: () => Promise<void>;
  request: (method: string, path: string, body?: unknown, token?: string) => Promise<Reply>;
  _internal: Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
}

/** Свежий экземпляр мок-API в изолированном «окне» (без localStorage — данные в памяти). */
function loadDemo(): { demo: Demo; win: Record<string, unknown> } {
  const win: Record<string, unknown> = { console };
  new Function("window", code)(win);
  return { demo: win.LombardDemo as Demo, win };
}

const { demo, win } = loadDemo();
const fn = demo._internal;

async function login(email: string) {
  const r = await demo.request("POST", "/auth/login", { email, password: "demo1234" });
  expect(r.status).toBe(200);
  return r.body.access_token as string;
}

describe("формулы демо = формулы backend", () => {
  it.each(fixture.estimates.map((e) => [e.input.category_code, e] as const))(
    "предоценка (%s)",
    (_code, expected) => {
      const r = fn.estimate(expected.input);
      expect({
        value: r.value,
        value_min: r.value_min,
        value_max: r.value_max,
        confidence: r.confidence,
        loan_min: r.loan_min,
        loan_max: r.loan_max,
        steps: r.steps,
        warnings: r.warnings,
        summary: r.summary,
      }).toEqual({
        value: expected.value,
        value_min: expected.value_min,
        value_max: expected.value_max,
        confidence: expected.confidence,
        loan_min: expected.loan_min,
        loan_max: expected.loan_max,
        steps: expected.steps,
        warnings: expected.warnings,
        summary: expected.summary,
      });
    },
  );

  it("расчёт займа и график", () => {
    const { input, ...expected } = fixture.quote;
    const q = fn.quote(input.amount, input.bp, input.term, input.start);
    expect({
      interest: q.interest,
      total_to_repay: q.total_to_repay,
      due_date: q.due_date,
      grace_until: q.grace_until,
      annual_rate_percent: q.annual_rate_percent,
      schedule: q.schedule,
    }).toEqual(expected);
    expect(q.rate_label).toBe("0,25 % в день");
  });

  it("проверка условий займа по категории", () => {
    const gold = {
      name: "Золото",
      ltv_percent: 80,
      daily_rate_bp: 25,
      min_term_days: 7,
      max_term_days: 60,
    };
    for (const t of fixture.terms) {
      expect(fn.validateTerms(gold, { loan_amount: null, ...t.input })).toEqual(t.errors);
    }
  });

  it("займ: проценты, срок, просрочка и изъятие по времени Казахстана", () => {
    const loan = {
      principal: 12_000_000,
      daily_rate_bp: 25,
      issued_at: Date.parse(fixture.loan.issued_at),
      interest_from: Date.parse(fixture.loan.issued_at),
      due_at: Date.parse(fixture.loan.due_at),
    };
    for (const { now, ...expected } of fixture.figures) {
      expect(fn.figures(loan, Date.parse(now))).toEqual(expected);
    }
  });

  it("карты и телефоны", () => {
    for (const [card, problem] of Object.entries(fixture.cards)) {
      expect(fn.cardProblem(card)).toBe(problem);
    }
    expect(fn.maskCard("4400430123456789")).toBe(fixture.mask);
    for (const [raw, e164] of Object.entries(fixture.phones)) {
      expect(fn.normalizeKzPhone(raw)).toBe(e164);
    }
  });

  it("машина состояний — та же таблица переходов", () => {
    expect(Object.keys(fn.TRANSITIONS)).toHaveLength(24);
    expect(fn.TRANSITIONS["ITEM_DELIVERED>INSPECTED"]).toEqual(["EXPERT"]);
    expect(fn.STATUS_LABELS.FORFEITED).toBe("Перешло ломбарду");
  });
});

describe("контракт мок-API", () => {
  beforeEach(() => demo.reset());

  it("перехватывает fetch только для /api", async () => {
    const fetch = win.fetch as typeof globalThis.fetch;
    const resp = await fetch("/api/catalog/categories");
    expect(resp.status).toBe(200);
    const cats = (await resp.json()) as { code: string; allowed_metals: string[] }[];
    expect(cats.map((c) => c.code)).toEqual([
      "gold",
      "silver",
      "platinum",
      "watches",
      "electronics",
    ]);
    expect(cats[0]!.allowed_metals).toEqual(["GOLD"]);
    await expect(fetch("/other.json")).rejects.toThrow();
  });

  it("вход: неверный пароль — 401, демо-аккаунт — токены и профиль", async () => {
    const bad = await demo.request("POST", "/auth/login", {
      email: "client@lombard.kz",
      password: "nope",
    });
    expect(bad).toMatchObject({ status: 401, body: { detail: "Неверный e-mail или пароль" } });
    const token = await login("client@lombard.kz");
    const me = await demo.request("GET", "/auth/me", undefined, token);
    expect(me.body).toMatchObject({
      full_name: "Айгерим Садыкова",
      role: "CLIENT",
      phone_display: "+7 701 123-45-67",
    });
    expect((await demo.request("GET", "/auth/me")).status).toBe(401);
  });

  it("регистрация: ошибки полей 422, повтор e-mail — 409", async () => {
    const r = await demo.request("POST", "/auth/register", {
      email: "x",
      password: "short",
      full_name: "А",
      phone: "+1 555",
    });
    expect(r.status).toBe(422);
    const fields = (r.body.detail as { loc: string[] }[]).map((d) => d.loc[1]);
    expect(fields).toEqual(expect.arrayContaining(["password", "full_name", "phone"]));
    const ok = await demo.request("POST", "/auth/register", {
      email: "New@Example.kz",
      password: "secret123",
      full_name: "Дана  Сейтказиева",
    });
    expect(ok.status).toBe(201);
    expect(ok.body.user).toMatchObject({ email: "new@example.kz", full_name: "Дана Сейтказиева" });
    const again = await demo.request("POST", "/auth/register", {
      email: "new@example.kz",
      password: "secret123",
      full_name: "Дана",
    });
    expect(again.status).toBe(409);
  });

  it("роли: курьеру нельзя к заявкам, эксперту — к займам", async () => {
    const courier = await login("courier@lombard.kz");
    expect((await demo.request("GET", "/applications", undefined, courier)).status).toBe(403);
    const expert = await login("expert@lombard.kz");
    expect((await demo.request("GET", "/loans", undefined, expert)).status).toBe(403);
  });

  it("заявка без фото не отправляется, и изменения откатываются", async () => {
    const token = await login("client@lombard.kz");
    const list = await demo.request("GET", "/applications", undefined, token);
    expect(list.body).toHaveLength(1);
    expect(list.body[0]).toMatchObject({ number: "Л-000001", status: "DRAFT" });
    const r = await demo.request("POST", "/applications/1/submit", undefined, token);
    expect(r.status).toBe(422);
    expect(r.body.message).toBe("Заявку пока нельзя отправить");
    expect(r.body.detail[0]).toMatchObject({
      loc: ["body", "photos"],
      msg: "Добавьте хотя бы одно фото изделия",
    });
    const card = await demo.request("GET", "/applications/1", undefined, token);
    expect(card.body.status).toBe("DRAFT");
    expect(card.body.actions).toEqual(["edit", "submit", "delete"]);
    expect(card.body.history).toHaveLength(1);
  });

  it("правка черновика: проверка пробы для металла", async () => {
    const token = await login("client@lombard.kz");
    const bad = await demo.request("PATCH", "/applications/1", { fineness: 925 }, token);
    expect(bad.status).toBe(422);
    expect(bad.body.detail[0].msg).toMatch(/Проба 925 не используется для металла «Золото»/);
    const ok = await demo.request("PATCH", "/applications/1", { weight_g: 4.25 }, token);
    expect(ok.body.weight_g).toBe(4.25);
  });

  it("калькулятор по параметрам изделия — та же формула", async () => {
    const r = await demo.request("POST", "/calculator", {
      category_code: "gold",
      term_days: 30,
      metal: "GOLD",
      fineness: 585,
      weight_g: 4.2,
      condition: "GOOD",
    });
    expect(r.status).toBe(200);
    const expected = fn.estimate({ ...fixture.estimates[0]!.input, photo_confidence: null });
    expect(r.body).toMatchObject({
      estimated: true,
      market_value: expected.value,
      max_loan_amount: Math.floor((expected.value * 80) / 100 / 10000) * 10000,
    });
    expect(r.body.quote.term_days).toBe(30);
  });

  it("панель демо: смена роли, перемотка времени и сброс", async () => {
    const sw = await demo.request("POST", "/demo/switch", { role: "EXPERT" });
    expect(sw.body.user).toMatchObject({ role: "EXPERT", full_name: "Ерлан Касымов" });
    const moved = await demo.request("POST", "/demo/clock", { days: 7 });
    expect(moved.body.offset_days).toBe(7);
    const admin = await login("admin@lombard.kz");
    const clock = await demo.request("GET", "/admin/clock", undefined, admin);
    expect(clock.body.offset_days).toBe(7);
    expect((await demo.request("DELETE", "/demo/clock")).body.offset_days).toBe(0);

    await demo.request("POST", "/demo/clock", { days: 3 });
    const reset = await demo.request("POST", "/demo/reset");
    expect(reset.status).toBe(204);
    expect((await demo.request("GET", "/demo/state")).body.offset_days).toBe(0);
  });

  it("неизвестный адрес — 404, не тот метод — 405", async () => {
    expect((await demo.request("GET", "/nope")).status).toBe(404);
    expect((await demo.request("PUT", "/catalog/categories")).status).toBe(405);
  });
});
