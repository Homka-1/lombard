import { apiGet, apiPost } from "./client";
import type {
  AuthResponse,
  CalculatorInput,
  CalculatorResult,
  Category,
  ConditionInfo,
  MetalInfo,
  RegisterInput,
  User,
} from "./types";

export const authApi = {
  login: (email: string, password: string) =>
    apiPost<AuthResponse>("/auth/login", { email, password }, { anonymous: true }),
  register: (data: RegisterInput) =>
    apiPost<AuthResponse>("/auth/register", data, { anonymous: true }),
  me: () => apiGet<User>("/auth/me"),
};

export const catalogApi = {
  categories: () => apiGet<Category[]>("/catalog/categories", { anonymous: true }),
  metals: () => apiGet<MetalInfo[]>("/catalog/metals", { anonymous: true }),
  conditions: () => apiGet<ConditionInfo[]>("/catalog/conditions", { anonymous: true }),
};

export const calculatorApi = {
  calculate: (input: CalculatorInput, signal?: AbortSignal) =>
    apiPost<CalculatorResult>("/calculator", input, { anonymous: true, signal }),
};

export const notificationsApi = {
  unreadCount: () => apiGet<{ unread: number }>("/notifications/unread-count"),
};
