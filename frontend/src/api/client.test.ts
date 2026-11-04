import { beforeEach, describe, expect, it } from "vitest";
import { MockHttpError, mockApi } from "../test/utils";
import { ApiError, NETWORK_ERROR, apiGet, getTokens, setTokens, toApiError } from "./client";

describe("toApiError", () => {
  it("parses 422 field problems", async () => {
    const err = await toApiError(
      new Response(
        JSON.stringify({
          detail: [
            { loc: ["body", "email"], msg: "Некорректный адрес e-mail" },
            { loc: ["body", "password"], msg: "Минимальная длина — 8 симв." },
          ],
        }),
        { status: 422 },
      ),
    );
    expect(err.status).toBe(422);
    expect(err.message).toBe("Проверьте введённые данные");
    expect(err.fieldMessage("email")).toBe("Некорректный адрес e-mail");
    expect(err.fieldMessage("password")).toMatch(/8/);
  });

  it("uses the business message and the string detail", async () => {
    const calc = await toApiError(
      new Response(
        JSON.stringify({
          detail: [{ loc: ["body", "term_days"], msg: "срок от 7 до 60 дней" }],
          message: "Проверьте условия расчёта",
        }),
        { status: 422 },
      ),
    );
    expect(calc.message).toBe("Проверьте условия расчёта");
    const conflict = await toApiError(
      new Response(JSON.stringify({ detail: "Уже есть" }), { status: 409 }),
    );
    expect(conflict.message).toBe("Уже есть");
    const html = await toApiError(new Response("<html>", { status: 502 }));
    expect(html.message).toBe("Сервер ответил ошибкой 502");
  });
});

describe("apiFetch", () => {
  beforeEach(() => setTokens(null));

  it("sends the bearer token", async () => {
    setTokens({ access: "a1", refresh: "r1" });
    const fetch = mockApi({ "GET /api/auth/me": () => ({ id: 1 }) });
    await apiGet("/auth/me");
    const headers = fetch.mock.calls[0]![1]!.headers as Headers;
    expect(headers.get("Authorization")).toBe("Bearer a1");
  });

  it("refreshes tokens once on 401 and retries", async () => {
    setTokens({ access: "old", refresh: "r1" });
    let calls = 0;
    mockApi({
      "GET /api/auth/me": (_b, init) => {
        calls++;
        const auth = (init.headers as Headers).get("Authorization");
        return auth === "Bearer new"
          ? { id: 7 }
          : new MockHttpError(401, { detail: "Токен истёк" });
      },
      "POST /api/auth/refresh": (body) => {
        expect(body).toEqual({ refresh_token: "r1" });
        return { access_token: "new", refresh_token: "r2" };
      },
    });
    await expect(apiGet("/auth/me")).resolves.toEqual({ id: 7 });
    expect(calls).toBe(2);
    expect(getTokens()).toEqual({ access: "new", refresh: "r2" });
    expect(JSON.parse(localStorage.getItem("lombard.auth")!)).toEqual({
      access: "new",
      refresh: "r2",
    });
  });

  it("drops the session when refresh fails", async () => {
    setTokens({ access: "old", refresh: "bad" });
    mockApi({
      "GET /api/auth/me": () => new MockHttpError(401, { detail: "Требуется вход в систему" }),
      "POST /api/auth/refresh": () => new MockHttpError(401, { detail: "Токен истёк" }),
    });
    await expect(apiGet("/auth/me")).rejects.toMatchObject({ status: 401 });
    expect(getTokens()).toBeNull();
  });

  it("reports network failures in Russian", async () => {
    mockApi({
      "GET /api/catalog/categories": () => {
        throw new TypeError("Failed to fetch");
      },
    });
    const err = await apiGet("/catalog/categories").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).message).toBe(NETWORK_ERROR);
  });
});
