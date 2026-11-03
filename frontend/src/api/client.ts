/** Minimal API client. Requests go to `/api/*`, proxied to the backend by Vite in dev. */

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export async function apiGet<T>(path: string, init?: RequestInit): Promise<T> {
  const resp = await fetch(`/api${path}`, {
    ...init,
    headers: { Accept: "application/json", ...init?.headers },
  });
  if (!resp.ok) {
    throw new ApiError(resp.status, `Сервер ответил ошибкой ${resp.status}`);
  }
  return (await resp.json()) as T;
}

export interface Health {
  status: string;
  app: string;
  version: string;
  environment: string;
  currency: string;
  time: string;
}

export const getHealth = () => apiGet<Health>("/health");
