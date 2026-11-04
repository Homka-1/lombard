import type { CourierLoad, CourierTask, Loan, MetalPrice, Stats } from "../../api/types";
import { formatTenge, NBSP } from "../../lib/format";
import { addDaysIso, dayKz } from "../../lib/time";

const fmt1 = (n: number) => n.toLocaleString("ru-RU", { maximumFractionDigits: 1 });

/** Крупные суммы для плиток: «18,4 млн ₸», «950 тыс. ₸»; меньше 10 000 ₸ — как есть. */
export function formatTengeCompact(tiyn: number): string {
  const t = tiyn / 100;
  if (Math.abs(t) >= 1_000_000) return `${fmt1(t / 1_000_000)}${NBSP}млн${NBSP}₸`;
  if (Math.abs(t) >= 10_000) return `${fmt1(t / 1_000)}${NBSP}тыс.${NBSP}₸`;
  return formatTenge(tiyn);
}

export interface DayBucket {
  date: string;
  amount: number;
  count: number;
}

/** Выдачи займов по дням (время Казахстана) за `daysBack` дней, заканчивая `today`. */
export function issuedByDay(loans: Loan[], today: string, daysBack: number): DayBucket[] {
  const buckets: DayBucket[] = [];
  for (let i = daysBack - 1; i >= 0; i--)
    buckets.push({ date: addDaysIso(today, -i), amount: 0, count: 0 });
  const index = new Map(buckets.map((b, i) => [b.date, i]));
  for (const loan of loans) {
    const i = index.get(dayKz(loan.issued_at));
    if (i === undefined) continue;
    buckets[i]!.amount += loan.principal;
    buckets[i]!.count += 1;
  }
  return buckets;
}

/** Этапы заявки для дашборда (как в макете: «Заявки по этапам»). */
export const STAGES: { label: string; statuses: string[] }[] = [
  { label: "Предоценка", statuses: ["SUBMITTED", "PRE_ESTIMATED"] },
  { label: "У эксперта", statuses: ["UNDER_REVIEW", "NEED_INFO"] },
  { label: "Предложение", statuses: ["OFFER_SENT"] },
  {
    label: "Курьер",
    statuses: ["OFFER_ACCEPTED", "COURIER_SCHEDULED", "COURIER_EN_ROUTE", "ITEM_PICKED_UP"],
  },
  { label: "Осмотр", statuses: ["ITEM_DELIVERED", "INSPECTED"] },
  { label: "Займ действует", statuses: ["FUNDS_ISSUED", "LOAN_ACTIVE", "EXTENDED", "OVERDUE"] },
];

export function stageCounts(stats: Stats): { label: string; count: number }[] {
  return STAGES.map((s) => ({
    label: s.label,
    count: s.statuses.reduce((n, st) => n + (stats.by_status[st] ?? 0), 0),
  }));
}

/** Доля просроченных среди открытых займов, %. */
export function overdueShare(stats: Stats): number {
  const open = stats.loans_active + stats.loans_overdue;
  return open ? (stats.loans_overdue / open) * 100 : 0;
}

/**
 * Автоназначение: каждому выезду без курьера — наименее загруженный курьер его города
 * (как делает backend при вызове курьера). Загрузка учитывает уже распределённые выезды.
 */
export function autoAssignPlan(
  tasks: CourierTask[],
  couriers: CourierLoad[],
): { taskId: number; courierId: number }[] {
  const load = new Map(couriers.map((c) => [c.courier.id, c.open_tasks]));
  const plan: { taskId: number; courierId: number }[] = [];
  for (const t of tasks) {
    if (t.courier || !t.actions.includes("assign")) continue;
    const local = couriers.filter((c) => c.courier.city === t.city);
    if (local.length === 0) continue;
    const best = local.reduce((a, b) =>
      (load.get(b.courier.id) ?? 0) < (load.get(a.courier.id) ?? 0) ? b : a,
    );
    plan.push({ taskId: t.id, courierId: best.courier.id });
    load.set(best.courier.id, (load.get(best.courier.id) ?? 0) + 1);
  }
  return plan;
}

export interface MetalRow {
  metal: MetalPrice["metal"];
  current: MetalPrice;
  /** Изменение к предыдущей цене, % (null — цена одна). */
  change: number | null;
}

/** Текущая цена каждого металла и её изменение к предыдущей записи. */
export function metalRows(prices: MetalPrice[]): MetalRow[] {
  const byMetal = new Map<string, MetalPrice[]>();
  for (const p of prices) byMetal.set(p.metal, [...(byMetal.get(p.metal) ?? []), p]);
  const rows: MetalRow[] = [];
  for (const [metal, list] of byMetal) {
    const sorted = [...list].sort(
      (a, b) => new Date(b.effective_from).getTime() - new Date(a.effective_from).getTime(),
    );
    const ci = sorted.findIndex((p) => p.is_current);
    const current = sorted[ci >= 0 ? ci : 0]!;
    const prev = sorted[(ci >= 0 ? ci : 0) + 1];
    rows.push({
      metal: metal as MetalPrice["metal"],
      current,
      change: prev
        ? ((current.price_per_gram - prev.price_per_gram) / prev.price_per_gram) * 100
        : null,
    });
  }
  const order = ["GOLD", "SILVER", "PLATINUM", "PALLADIUM"];
  return rows.sort((a, b) => order.indexOf(a.metal) - order.indexOf(b.metal));
}

export const METAL_LABEL: Record<string, string> = {
  GOLD: "Золото",
  SILVER: "Серебро",
  PLATINUM: "Платина",
  PALLADIUM: "Палладий",
};

export function formatChange(pct: number): string {
  const sign = pct > 0 ? "+" : pct < 0 ? "−" : "";
  return `${sign}${Math.abs(pct).toLocaleString("ru-RU", { maximumFractionDigits: 1 })}${NBSP}%`;
}

const visitsWord = (n: number) => {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return "выезд";
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return "выезда";
  return "выездов";
};

export const courierLoadLabel = (n: number) => `${n}${NBSP}${visitsWord(n)}`;
