import { api, apiFetch, apiGet, apiPost } from "./client";
import type {
  AdminCategory,
  Application,
  CategoryCreate,
  CategoryUpdate,
  ClockState,
  CourierLoad,
  CourierStep,
  CourierTask,
  InspectionInput,
  InspectionPreview,
  JobsResult,
  LoanQuote,
  MetalPrice,
  Metal,
  OfferCreate,
  OfferTerms,
  QueueItem,
  QueueScope,
  Role,
  StaffCreate,
  Stats,
  TaskScope,
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

export const expertApi = {
  queue: (scope: QueueScope) => apiGet<QueueItem[]>(`/expert/queue?scope=${scope}`),
  take: (id: number) => apiPost<Application>(`/expert/applications/${id}/take`),
  quote: (id: number, terms: OfferTerms, signal?: AbortSignal) =>
    apiPost<LoanQuote>(`/expert/applications/${id}/quote`, terms, { signal }),
  sendOffer: (id: number, data: OfferCreate) =>
    apiPost<Application>(`/expert/applications/${id}/offer`, data),
  needInfo: (id: number, comment: string) =>
    apiPost<Application>(`/expert/applications/${id}/need-info`, { comment: comment || null }),
  reject: (id: number, reason: string) =>
    apiPost<Application>(`/expert/applications/${id}/reject`, { reason: reason || null }),
  inspectionQuote: (id: number, data: InspectionInput, signal?: AbortSignal) =>
    apiPost<InspectionPreview>(`/expert/applications/${id}/inspection/quote`, data, { signal }),
  inspect: (id: number, data: InspectionInput) =>
    apiPost<Application>(`/expert/applications/${id}/inspection`, data),
};

export const courierApi = {
  tasks: (scope: TaskScope, day?: string) =>
    apiGet<CourierTask[]>(`/courier/tasks?scope=${scope}${day ? `&day=${day}` : ""}`),
  step: (id: number, step: CourierStep) =>
    apiPost<CourierTask>(`/courier/tasks/${id}/${step === "pick_up" ? "pick-up" : step}`),
};

export interface AdminTaskFilter {
  scope?: TaskScope;
  day?: string;
  courierId?: number;
  unassigned?: boolean;
}

function query(params: Record<string, string | number | boolean | undefined>): string {
  const q = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== "" && v !== false)
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
    .join("&");
  return q ? `?${q}` : "";
}

export const adminApi = {
  stats: () => apiGet<Stats>("/admin/stats"),
  loans: () => apiGet<Loan[]>("/loans"),
  categories: () => apiGet<AdminCategory[]>("/admin/categories"),
  createCategory: (data: CategoryCreate) => apiPost<AdminCategory>("/admin/categories", data),
  updateCategory: (id: number, data: CategoryUpdate) =>
    api<AdminCategory>(`/admin/categories/${id}`, { method: "PATCH", body: data }),
  metalPrices: () => apiGet<MetalPrice[]>("/admin/metal-prices"),
  createMetalPrice: (metal: Metal, pricePerGram: number) =>
    apiPost<MetalPrice>("/admin/metal-prices", { metal, price_per_gram: pricePerGram }),
  users: (role?: Role | "", q?: string) =>
    apiGet<User[]>(`/admin/users${query({ role: role || undefined, q: q?.trim() || undefined })}`),
  updateUser: (id: number, data: { role?: Role; is_active?: boolean; city?: string | null }) =>
    api<User>(`/admin/users/${id}`, { method: "PATCH", body: data }),
  createUser: (data: StaffCreate) => apiPost<User>("/admin/users", data),
  couriers: () => apiGet<CourierLoad[]>("/admin/couriers"),
  tasks: (f: AdminTaskFilter = {}) =>
    apiGet<CourierTask[]>(
      `/admin/courier-tasks${query({
        scope: f.scope,
        day: f.day,
        courier_id: f.courierId,
        unassigned: f.unassigned,
      })}`,
    ),
  assign: (taskId: number, courierId: number) =>
    apiPost<CourierTask>(`/admin/courier-tasks/${taskId}/assign`, { courier_id: courierId }),
  clock: () => apiGet<ClockState>("/admin/clock"),
  advanceClock: (days: number) =>
    apiPost<ClockState & { jobs: JobsResult | null }>("/admin/clock", {
      days,
      hours: 0,
      run_jobs: true,
    }),
  resetClock: () => api<ClockState>("/admin/clock", { method: "DELETE" }),
  runJobs: () => apiPost<JobsResult>("/admin/jobs/run"),
};
