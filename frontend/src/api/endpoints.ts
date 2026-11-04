import { api, apiFetch, apiGet, apiPost } from "./client";
import type {
  Application,
  ApplicationInput,
  ApplicationListItem,
  AuthResponse,
  City,
  ExtensionQuote,
  Loan,
  Slot,
  VisitInput,
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

export const applicationsApi = {
  list: () => apiGet<ApplicationListItem[]>("/applications"),
  get: (id: number) => apiGet<Application>(`/applications/${id}`),
  create: (data: ApplicationInput & { category_id: number; title: string }) =>
    apiPost<Application>("/applications", data),
  update: (id: number, data: ApplicationInput) =>
    api<Application>(`/applications/${id}`, { method: "PATCH", body: data }),
  remove: (id: number) => api<void>(`/applications/${id}`, { method: "DELETE" }),
  uploadPhotos: (id: number, files: File[]) => {
    const form = new FormData();
    files.forEach((f) => form.append("files", f));
    return apiPost<Application>(`/applications/${id}/photos`, form);
  },
  deletePhoto: (id: number, photoId: number) =>
    api<Application>(`/applications/${id}/photos/${photoId}`, { method: "DELETE" }),
  reorderPhotos: (id: number, photoIds: number[]) =>
    api<Application>(`/applications/${id}/photos/order`, {
      method: "PUT",
      body: { photo_ids: photoIds },
    }),
  submit: (id: number) => apiPost<Application>(`/applications/${id}/submit`),
  acceptOffer: (id: number) => apiPost<Application>(`/applications/${id}/offer/accept`),
  declineOffer: (id: number, reason?: string) =>
    apiPost<Application>(`/applications/${id}/offer/decline`, { reason: reason || null }),
  scheduleCourier: (id: number, data: VisitInput) =>
    apiPost<Application>(`/applications/${id}/courier`, data),
  rescheduleCourier: (id: number, data: VisitInput) =>
    api<Application>(`/applications/${id}/courier`, { method: "PUT", body: data }),
  payout: (id: number, cardNumber: string) =>
    apiPost<Application>(`/applications/${id}/payout`, { card_number: cardNumber }),
  scheduleReturn: (id: number, data: VisitInput) =>
    apiPost<Application>(`/applications/${id}/return`, data),
};

export const deliveryApi = {
  cities: () => apiGet<City[]>("/delivery/cities"),
  slots: (city: string) => apiGet<Slot[]>(`/delivery/slots?city=${encodeURIComponent(city)}`),
};

export const loansApi = {
  list: () => apiGet<Loan[]>("/loans"),
  get: (id: number) => apiGet<Loan>(`/loans/${id}`),
  extensionQuote: (id: number, termDays: number) =>
    apiGet<ExtensionQuote>(`/loans/${id}/extension?term_days=${termDays}`),
  repay: (id: number, cardNumber: string) =>
    apiPost<Loan>(`/loans/${id}/repay`, { card_number: cardNumber }),
  extend: (id: number, cardNumber: string, termDays: number) =>
    apiPost<Loan>(`/loans/${id}/extend`, { card_number: cardNumber, term_days: termDays }),
  /** Залоговый билет (HTML). `ticket_url` приходит с префиксом `/api`. */
  ticket: async (ticketUrl: string) => {
    const resp = await apiFetch(ticketUrl.replace(/^\/api/, ""), {
      headers: { Accept: "text/html" },
    });
    return resp.text();
  },
};
