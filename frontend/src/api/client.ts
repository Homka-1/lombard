/**
 * API-клиент. Запросы идут на `/api/*` (в dev Vite проксирует их на backend).
 * Access-токен подставляется автоматически; при 401 клиент один раз обновляет пару
 * токенов через `/auth/refresh` и повторяет запрос.
 */

export interface FieldProblem {
  /** Имя поля (последний элемент `loc`), например `email` или `term_days`. */
  field: string;
  message: string;
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly fields: FieldProblem[] = [],
  ) {
    super(message);
    this.name = "ApiError";
  }

  /** Сообщение для конкретного поля формы. */
  fieldMessage(field: string): string | undefined {
    return this.fields.find((f) => f.field === field)?.message;
  }
}

export const NETWORK_ERROR = "Нет связи с сервером. Проверьте подключение и попробуйте ещё раз.";

const FALLBACK: Record<number, string> = {
  400: "Запрос не принят",
  401: "Войдите в систему",
  402: "Банк отклонил операцию",
  403: "Недостаточно прав для этого действия",
  404: "Не найдено",
  409: "Действие сейчас недоступно",
  413: "Файл слишком большой",
  422: "Проверьте введённые данные",
};

interface RawProblem {
  loc?: (string | number)[];
  msg?: string;
}

/** Разбор ответов backend: 422 `{detail:[{loc,msg}], message}`, остальные — `{detail}`. */
export async function toApiError(resp: Response): Promise<ApiError> {
  let body: unknown = null;
  try {
    body = await resp.json();
  } catch {
    /* не JSON */
  }
  const fallback = FALLBACK[resp.status] ?? `Сервер ответил ошибкой ${resp.status}`;
  if (body && typeof body === "object") {
    const { detail, message } = body as { detail?: unknown; message?: unknown };
    if (Array.isArray(detail)) {
      const fields = (detail as RawProblem[]).map((p) => ({
        field: String(p.loc?.[p.loc.length - 1] ?? ""),
        message: p.msg ?? "Некорректное значение",
      }));
      const text =
        typeof message === "string" ? message : fields.length === 1 ? fields[0]!.message : fallback;
      return new ApiError(resp.status, text, fields);
    }
    if (typeof detail === "string") return new ApiError(resp.status, detail);
  }
  return new ApiError(resp.status, fallback);
}

// ---------- токены ----------

export interface TokenStore {
  access: string | null;
  refresh: string | null;
}

type TokenListener = (tokens: TokenStore | null) => void;

const STORAGE_KEY = "lombard.auth";
let tokens: TokenStore | null = readStored();
let onTokensChange: TokenListener | null = null;

function readStored(): TokenStore | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as TokenStore) : null;
  } catch {
    return null;
  }
}

export function getTokens(): TokenStore | null {
  return tokens;
}

export function setTokens(next: TokenStore | null): void {
  tokens = next;
  try {
    if (next) localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* приватный режим — токены живут до перезагрузки */
  }
  onTokensChange?.(next);
}

/** AuthProvider подписывается, чтобы узнать о выходе из-за истёкшей сессии. */
export function subscribeTokens(listener: TokenListener | null): void {
  onTokensChange = listener;
}

/** Для тестов: перечитать хранилище. */
export function reloadTokens(): void {
  tokens = readStored();
}

// ---------- запросы ----------

export interface RequestOptions extends Omit<RequestInit, "body"> {
  /** Объект уходит как JSON; FormData — как есть. */
  body?: unknown;
  /** Не подставлять токен и не обновлять его (вход, регистрация). */
  anonymous?: boolean;
}

let refreshing: Promise<boolean> | null = null;

async function refreshTokens(): Promise<boolean> {
  const refresh = tokens?.refresh;
  if (!refresh) return false;
  refreshing ??= (async () => {
    try {
      const resp = await fetch("/api/auth/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ refresh_token: refresh }),
      });
      if (!resp.ok) {
        setTokens(null);
        return false;
      }
      const pair = (await resp.json()) as { access_token: string; refresh_token: string };
      setTokens({ access: pair.access_token, refresh: pair.refresh_token });
      return true;
    } catch {
      return false;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

function buildInit(opts: RequestOptions): RequestInit {
  const { body, anonymous, headers, ...rest } = opts;
  const h = new Headers(headers);
  h.set("Accept", "application/json");
  let payload: BodyInit | undefined;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) {
    h.set("Content-Type", "application/json");
    payload = JSON.stringify(body);
  }
  if (!anonymous && tokens?.access) h.set("Authorization", `Bearer ${tokens.access}`);
  return { ...rest, headers: h, body: payload };
}

export async function apiFetch(path: string, opts: RequestOptions = {}): Promise<Response> {
  let resp: Response;
  try {
    resp = await fetch(`/api${path}`, buildInit(opts));
    if (resp.status === 401 && !opts.anonymous && tokens?.refresh && (await refreshTokens())) {
      resp = await fetch(`/api${path}`, buildInit(opts));
    }
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    throw new ApiError(0, NETWORK_ERROR);
  }
  if (!resp.ok) throw await toApiError(resp);
  return resp;
}

export async function api<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const resp = await apiFetch(path, opts);
  if (resp.status === 204) return undefined as T;
  return (await resp.json()) as T;
}

export const apiGet = <T>(path: string, opts?: RequestOptions) => api<T>(path, opts);
export const apiPost = <T>(path: string, body?: unknown, opts?: RequestOptions) =>
  api<T>(path, { ...opts, method: "POST", body });
