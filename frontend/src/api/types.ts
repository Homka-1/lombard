/** Типы ответов backend (см. `backend/app/schemas`). Суммы — в тиынах. */

import type { ApplicationStatus } from "../design/status.gen";

export type { ApplicationStatus };

export type Role = "CLIENT" | "EXPERT" | "COURIER" | "ADMIN";

export interface User {
  id: number;
  email: string;
  full_name: string;
  phone: string | null;
  phone_display: string | null;
  role: Role;
  is_active: boolean;
  city: string | null;
  created_at: string;
  last_login_at: string | null;
}

export interface TokenPair {
  access_token: string;
  refresh_token: string;
  token_type: "bearer";
  access_expires_at: string;
  refresh_expires_at: string;
}

export interface AuthResponse extends TokenPair {
  user: User;
}

export interface RegisterInput {
  email: string;
  password: string;
  full_name: string;
  phone?: string | null;
  city?: string | null;
}

export type Metal = "GOLD" | "SILVER" | "PLATINUM" | "PALLADIUM";
export type ItemCondition = "NEW" | "EXCELLENT" | "GOOD" | "FAIR" | "POOR";

export interface Category {
  id: number;
  code: string;
  name: string;
  description: string | null;
  ltv_percent: number;
  daily_rate_bp: number;
  min_term_days: number;
  max_term_days: number;
  requires_metal: boolean;
  allowed_metals: Metal[];
}

export interface MetalInfo {
  metal: Metal;
  label: string;
  finenesses: number[];
  price_per_gram: number | null;
  effective_from: string | null;
}

export interface ConditionInfo {
  condition: ItemCondition;
  label: string;
}

export interface CalculatorInput {
  category_code: string;
  term_days: number;
  market_value?: number;
  metal?: Metal;
  fineness?: number;
  weight_g?: number;
  brand?: string;
  condition?: ItemCondition;
}

export interface SchedulePoint {
  day: number;
  date: string;
  interest: number;
  total: number;
  is_due_date: boolean;
}

export interface LoanQuote {
  loan_amount: number;
  daily_rate_bp: number;
  rate_label: string;
  annual_rate_percent: number;
  term_days: number;
  interest: number;
  total_to_repay: number;
  start_date: string;
  due_date: string;
  grace_until: string;
  schedule: SchedulePoint[];
}

export interface CalculatorResult {
  category_id: number;
  category_name: string;
  ltv_percent: number;
  market_value: number;
  value_min: number;
  value_max: number;
  estimated: boolean;
  estimate_steps: { label: string; amount?: number; factor?: number }[];
  max_loan_amount: number;
  quote: LoanQuote;
}

// ---------- заявки (кабинет клиента) ----------

export type ApplicationAction =
  | "edit"
  | "submit"
  | "delete"
  | "accept_offer"
  | "decline_offer"
  | "schedule_courier"
  | "reschedule_courier"
  | "issue_funds"
  | "repay"
  | "extend"
  | "schedule_return";

export interface CategoryBrief {
  id: number;
  code: string;
  name: string;
  requires_metal: boolean;
  ltv_percent: number;
}

export interface UserBrief {
  id: number;
  full_name: string;
  phone: string | null;
  city: string | null;
}

export interface Photo {
  id: number;
  position: number;
  original_name: string;
  content_type: string;
  size_bytes: number;
  width: number | null;
  height: number | null;
  /** 0–100 — оценка качества снимка. */
  quality_score: number | null;
  url: string;
  thumb_url: string;
  created_at: string;
}

export interface PhotoIssueDetails {
  index: number;
  score: number;
  issues: string[];
  duplicate_of: number | null;
}

export interface Appraisal {
  id: number;
  kind: "AUTO" | "EXPERT" | "INSPECTION";
  value_min: number;
  value_max: number;
  value: number;
  confidence: number;
  comment: string | null;
  details: {
    photos?: { confidence: number; issues: string[]; photos: PhotoIssueDetails[] };
    loan_amount?: number;
    [key: string]: unknown;
  } | null;
  created_at: string;
}

export interface StatusHistoryEntry {
  id: number;
  from_status: ApplicationStatus | null;
  to_status: ApplicationStatus;
  to_status_label: string;
  actor_role: Role | null;
  comment: string | null;
  created_at: string;
}

export interface Offer {
  id: number;
  status: "SENT" | "ACCEPTED" | "DECLINED" | "EXPIRED" | "SUPERSEDED";
  status_label: string;
  market_value: number;
  value_min: number;
  value_max: number;
  ltv_percent: number | null;
  hallmark_confirmed: boolean | null;
  loan_amount: number;
  daily_rate_bp: number;
  rate_label: string;
  term_days: number;
  interest: number;
  total_to_repay: number;
  comment: string | null;
  expert: UserBrief;
  expires_at: string | null;
  decided_at: string | null;
  created_at: string;
  quote: LoanQuote;
}

export interface CourierVisit {
  id: number;
  kind: "PICKUP" | "RETURN";
  kind_label: string;
  status: "SCHEDULED" | "EN_ROUTE" | "PICKED_UP" | "DELIVERED" | "CANCELLED";
  status_label: string;
  courier: UserBrief | null;
  city: string;
  address: string;
  contact_phone: string;
  contact_phone_display: string;
  slot_start: string;
  slot_end: string;
  slot_label: string;
  comment: string | null;
  completed_at: string | null;
}

export type LoanStatus = "ACTIVE" | "OVERDUE" | "REPAID" | "FORFEITED";

export interface LoanSummary {
  id: number;
  ticket_number: string;
  status: LoanStatus;
  status_label: string;
  principal: number;
  daily_rate_bp: number;
  rate_label: string;
  issued_at: string;
  due_date: string;
  grace_until: string;
  days_used: number;
  accrued_interest: number;
  total_to_repay: number;
  days_left: number;
  overdue_days: number;
  grace_days_left: number;
  due_soon: boolean;
  extensions_count: number;
  closed_at: string | null;
  ticket_url: string;
}

export interface ApplicationListItem {
  id: number;
  number: string;
  status: ApplicationStatus;
  status_label: string;
  title: string;
  category: CategoryBrief;
  photo_count: number;
  cover_thumb_url: string | null;
  pre_estimate_min: number | null;
  pre_estimate_max: number | null;
  created_at: string;
  submitted_at: string | null;
  updated_at: string;
}

export interface Application {
  id: number;
  number: string;
  client_id: number;
  status: ApplicationStatus;
  status_label: string;
  category: CategoryBrief;
  title: string;
  description: string | null;
  metal: Metal | null;
  fineness: number | null;
  weight_g: number | null;
  brand: string | null;
  condition: ItemCondition | null;
  requested_amount: number | null;
  created_at: string;
  updated_at: string;
  submitted_at: string | null;
  editable: boolean;
  can_submit: boolean;
  max_photos: number;
  photos: Photo[];
  pre_estimate: Appraisal | null;
  client: UserBrief;
  expert: UserBrief | null;
  expert_appraisal: Appraisal | null;
  offer: Offer | null;
  courier_visit: CourierVisit | null;
  inspection: Appraisal | null;
  loan: LoanSummary | null;
  actions: ApplicationAction[];
  history: StatusHistoryEntry[];
}

export interface ApplicationInput {
  category_id?: number;
  title?: string;
  description?: string | null;
  metal?: Metal | null;
  fineness?: number | null;
  weight_g?: number | null;
  brand?: string | null;
  condition?: ItemCondition | null;
  requested_amount?: number | null;
}

export interface City {
  city: string;
  couriers: number;
}

export interface Slot {
  start: string;
  end: string;
  date: string;
  label: string;
  capacity: number;
  free: number;
  available: boolean;
}

export interface VisitInput {
  city: string;
  address: string;
  contact_phone?: string | null;
  slot_start: string;
  comment?: string | null;
}

export interface Payment {
  id: number;
  kind: "DISBURSEMENT" | "REPAYMENT" | "EXTENSION";
  kind_label: string;
  status: "PENDING" | "SUCCEEDED" | "FAILED";
  status_label: string;
  amount: number;
  destination: string | null;
  provider_ref: string | null;
  created_at: string;
}

export interface ExtensionQuote {
  term_days: number;
  pay_now: number;
  days_used: number;
  new_due_date: string;
  total_at_new_due: number;
  extensions_left: number;
}

export interface Loan extends LoanSummary {
  application: {
    id: number;
    number: string;
    title: string;
    category_name: string;
    status: ApplicationStatus;
    status_label: string;
  };
  client: UserBrief;
  term_days: number;
  due_at: string;
  interest_from: string;
  total_at_due: number;
  extensions_left: number;
  extension: ExtensionQuote | null;
  payments: Payment[];
  actions: ("repay" | "extend")[];
  now: string;
}
