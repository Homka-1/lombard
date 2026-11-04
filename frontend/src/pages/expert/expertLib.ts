import { useQuery } from "@tanstack/react-query";
import { expertApi } from "../../api/endpoints";
import type { Application, QueueScope } from "../../api/types";
import { minutesBetween } from "../../lib/time";

/** Норматив ответа эксперта на заявку, минут (как в макете: «Норматив — 15 минут»). */
export const REVIEW_SLA_MIN = 15;

/** Когда заявка встала в очередь: последний переход в «Предоценка готова» или отправка. */
export function queuedAt(app: Pick<Application, "history" | "submitted_at" | "created_at">) {
  const h = [...app.history].reverse().find((e) => e.to_status === "PRE_ESTIMATED");
  return h?.created_at ?? app.submitted_at ?? app.created_at;
}

export interface Sla {
  waited: number;
  left: number;
  late: boolean;
}

export function slaOf(since: string, now: Date = new Date()): Sla {
  const waited = minutesBetween(since, now);
  return { waited, left: REVIEW_SLA_MIN - waited, late: waited > REVIEW_SLA_MIN };
}

/** Сумма в тенге из поля ввода («119 000», «119000,50») → тиыны; пусто или мусор — null. */
export function parseTengeInput(value: string): number | null {
  const s = value.replace(/[\s\u00a0₸]/g, "").replace(",", ".");
  if (!/^\d{1,11}(\.\d{0,2})?$/.test(s)) return null;
  const n = Math.round(Number(s) * 100);
  return n > 0 ? n : null;
}

/** Тиыны → значение поля ввода: 11 900 000 → «119 000». */
export function tengeInputValue(tiyn: number): string {
  const whole = Math.round(tiyn / 100);
  return String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

/** Маска ввода суммы: только цифры, разряды через пробел. */
export function formatTengeInput(value: string): string {
  const digits = value
    .replace(/\D/g, "")
    .replace(/^0+(?=\d)/, "")
    .slice(0, 11);
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

/** Ставка «0,2» (% в день) → 20 б.п.; мусор — null. */
export function parseRateInput(value: string): number | null {
  const s = value.replace(/\s/g, "").replace(",", ".");
  if (!/^\d{1,2}(\.\d{0,2})?$/.test(s)) return null;
  const bp = Math.round(Number(s) * 100);
  return bp >= 1 && bp <= 10_000 ? bp : null;
}

/** 20 б.п. → «0,2». */
export const rateInputValue = (bp: number) =>
  (bp / 100).toLocaleString("ru-RU", { maximumFractionDigits: 2, useGrouping: false });

/** «Айгерим Касымова» → «Айгерим К.» — так клиент виден эксперту в заголовке. */
export function shortName(full: string): string {
  const [first, last] = full.split(/\s+/);
  return last ? `${first} ${last[0]}.` : (first ?? full);
}

/** Очередь обновляется сама: новые заявки приходят без перезагрузки страницы. */
const REFRESH_MS = 30_000;

export const useQueue = (scope: QueueScope) =>
  useQuery({
    queryKey: ["expert", "queue", scope],
    queryFn: () => expertApi.queue(scope),
    refetchInterval: REFRESH_MS,
  });
