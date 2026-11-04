/** Типы ответов backend (см. `backend/app/schemas`). Суммы — в тиынах. */

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
