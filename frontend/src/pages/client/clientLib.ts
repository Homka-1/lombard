import type { ItemKind } from "../../components/ItemArt";
import type { Application, ApplicationStatus, Photo } from "../../api/types";
import { formatDayKz } from "../../lib/time";

export {
  addDaysIso,
  formatDateTimeKz,
  formatDayKz,
  formatSlotDay,
  formatTimeKz,
  todayKz,
} from "../../lib/time";

/** Иллюстрация-заглушка по категории (если у заявки нет фото). */
export function itemKind(categoryCode: string): ItemKind {
  if (categoryCode === "watches") return "watch";
  if (categoryCode === "electronics") return "phone";
  return "ring";
}

/** Номер карты: только цифры, группы по 4. */
export function formatCardInput(value: string): string {
  return value
    .replace(/\D/g, "")
    .slice(0, 19)
    .replace(/(\d{4})(?=\d)/g, "$1 ");
}

export function cardDigits(value: string): string {
  return value.replace(/\D/g, "");
}

/** Проверка номера карты по алгоритму Луна (как в мок-банке). */
export function isCardValid(value: string): boolean {
  const digits = cardDigits(value);
  if (digits.length < 12 || digits.length > 19) return false;
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

/** Тестовая карта мок-банка (проходит любые операции). */
export const DEMO_CARD = "4400 4301 2345 6789";

// ---------- группы статусов ----------

const ACTIVE: ApplicationStatus[] = [
  "DRAFT",
  "SUBMITTED",
  "PRE_ESTIMATED",
  "UNDER_REVIEW",
  "NEED_INFO",
  "OFFER_SENT",
  "OFFER_ACCEPTED",
  "COURIER_SCHEDULED",
  "COURIER_EN_ROUTE",
  "ITEM_PICKED_UP",
  "ITEM_DELIVERED",
  "INSPECTED",
  "FUNDS_ISSUED",
  "LOAN_ACTIVE",
  "EXTENDED",
  "OVERDUE",
  "REPAID",
];

export const isActiveStatus = (s: ApplicationStatus) => ACTIVE.includes(s);

/** Статусы, в которых от клиента ждут действия. */
export const NEEDS_CLIENT: ApplicationStatus[] = [
  "DRAFT",
  "NEED_INFO",
  "OFFER_SENT",
  "OFFER_ACCEPTED",
  "INSPECTED",
  "OVERDUE",
];

// ---------- таймлайн «Ход заявки» ----------

/** Вехи обычного пути заявки: подпись, пока шаг впереди, и статусы, которые его закрывают. */
const MILESTONES: { label: string; statuses: ApplicationStatus[] }[] = [
  { label: "Заявка отправлена", statuses: ["SUBMITTED"] },
  { label: "Предоценка по фото", statuses: ["PRE_ESTIMATED"] },
  { label: "Эксперт оценивает", statuses: ["UNDER_REVIEW", "NEED_INFO"] },
  { label: "Предложение эксперта", statuses: ["OFFER_SENT", "OFFER_ACCEPTED"] },
  {
    label: "Курьер забирает изделие",
    statuses: ["COURIER_SCHEDULED", "COURIER_EN_ROUTE", "ITEM_PICKED_UP"],
  },
  { label: "Осмотр в ломбарде", statuses: ["ITEM_DELIVERED", "INSPECTED"] },
  { label: "Деньги на карту", statuses: ["FUNDS_ISSUED", "LOAN_ACTIVE", "EXTENDED", "OVERDUE"] },
  { label: "Погашение займа", statuses: ["REPAID"] },
  { label: "Изделие у вас", statuses: ["ITEM_RETURNED"] },
];

const FINAL: ApplicationStatus[] = ["REJECTED", "OFFER_DECLINED", "FORFEITED", "ITEM_RETURNED"];

export interface TimelineItem {
  key: string;
  label: string;
  state: "done" | "current" | "todo";
  at?: string;
  comment?: string | null;
}

/** Подсказка к текущему шагу: что сейчас происходит и что сделать клиенту. */
export function currentHint(app: Application): string | null {
  switch (app.status) {
    case "DRAFT":
      return "Заполните параметры и добавьте фото";
    case "PRE_ESTIMATED":
      return "Ждём свободного эксперта";
    case "UNDER_REVIEW":
      return "Обычно это занимает до часа";
    case "NEED_INFO":
      return "Эксперт просит дополнить заявку";
    case "OFFER_SENT":
      return app.offer?.expires_at
        ? `Примите или откажитесь до ${formatDayKz(app.offer.expires_at)}`
        : "Примите или откажитесь";
    case "OFFER_ACCEPTED":
      return "Выберите время визита курьера";
    case "COURIER_SCHEDULED":
      return app.courier_visit ? app.courier_visit.slot_label : null;
    case "ITEM_DELIVERED":
      return "Эксперт проверит изделие";
    case "INSPECTED":
      return "Укажите карту для выплаты";
    case "OVERDUE":
      return "Погасите займ, чтобы сохранить изделие";
    case "REPAID":
      return "Вызовите курьера, чтобы вернуть изделие";
    default:
      return null;
  }
}

/**
 * Пройденные статусы — из истории (с временем), впереди — оставшиеся вехи обычного пути.
 * Повторы (например, второй круг после «Нужны фото») остаются в истории как есть.
 */
export function buildTimeline(app: Application): TimelineItem[] {
  const items: TimelineItem[] = app.history
    .filter((h) => h.to_status !== "DRAFT")
    .map((h) => ({
      key: `h${h.id}`,
      label: h.to_status_label,
      state: "done" as const,
      at: h.created_at,
      // комментарии эксперта к запросу фото и отказу; остальные — служебные
      comment: h.to_status === "NEED_INFO" || h.to_status === "REJECTED" ? h.comment : null,
    }));
  if (items.length) items[items.length - 1]!.state = "current";
  if (app.status === "DRAFT") {
    items.push({ key: "draft", label: "Черновик", state: "current" });
  }
  if (FINAL.includes(app.status)) {
    if (items.length) items[items.length - 1]!.state = "done";
    return items;
  }
  const reached = MILESTONES.findIndex((m) => m.statuses.includes(app.status));
  MILESTONES.slice(reached + 1).forEach((m, i) =>
    items.push({ key: `m${i}`, label: m.label, state: "todo" }),
  );
  return items;
}

/** Снимки с оценкой качества ниже порога эксперт, скорее всего, попросит переснять. */
export const LOW_QUALITY = 50;

export const isLowQuality = (p: Photo) => p.quality_score !== null && p.quality_score < LOW_QUALITY;
