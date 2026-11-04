/** Время Казахстана (UTC+5) независимо от часового пояса браузера. */

import { NBSP, plural } from "./format";

/** Время Казахстана — UTC+5 круглый год. */
const KZ_OFFSET_MS = 5 * 60 * 60 * 1000;

export function kzDate(value: string | Date): Date {
  return new Date(new Date(value).getTime() + KZ_OFFSET_MS);
}

/** «14:40» по времени Казахстана. */
export function formatTimeKz(value: string | Date): string {
  const d = kzDate(value);
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}

const MONTHS = [
  "января",
  "февраля",
  "марта",
  "апреля",
  "мая",
  "июня",
  "июля",
  "августа",
  "сентября",
  "октября",
  "ноября",
  "декабря",
];
const WEEKDAYS = ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];

/** «3 ноября» по времени Казахстана (для отметок времени из API). */
export function formatDayKz(value: string | Date): string {
  const d = kzDate(value);
  return `${d.getUTCDate()}${NBSP}${MONTHS[d.getUTCMonth()]}`;
}

/** «3 ноября, 14:40». */
export function formatDateTimeKz(value: string | Date): string {
  return `${formatDayKz(value)}, ${formatTimeKz(value)}`;
}

/** Дата слота «2026-11-05» → «Чт, 5 ноября». */
export function formatSlotDay(isoDate: string): string {
  const d = new Date(`${isoDate}T12:00:00Z`);
  return `${WEEKDAYS[d.getUTCDay()]}, ${d.getUTCDate()}${NBSP}${MONTHS[d.getUTCMonth()]}`;
}

/** Сегодняшняя дата по Казахстану в формате ISO (для подписи «Сегодня» у слотов). */
export function todayKz(now: Date = new Date()): string {
  return kzDate(now).toISOString().slice(0, 10);
}

export function addDaysIso(iso: string, n: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** «Сегодня, 4 ноября» / «Завтра, 5 ноября» / «Чт, 6 ноября» для даты ISO. */
export function formatRelativeDay(isoDate: string, now: Date = new Date()): string {
  const today = todayKz(now);
  const d = new Date(`${isoDate}T12:00:00Z`);
  const tail = `${d.getUTCDate()}${NBSP}${MONTHS[d.getUTCMonth()]}`;
  if (isoDate === today) return `Сегодня, ${tail}`;
  if (isoDate === addDaysIso(today, 1)) return `Завтра, ${tail}`;
  if (isoDate === addDaysIso(today, -1)) return `Вчера, ${tail}`;
  return `${WEEKDAYS[d.getUTCDay()]}, ${tail}`;
}

/** Дата по Казахстану (ISO) для отметки времени из API. */
export const dayKz = (value: string | Date) => kzDate(value).toISOString().slice(0, 10);

/** Минуты между двумя моментами (не меньше нуля). */
export function minutesBetween(from: string | Date, to: Date = new Date()): number {
  return Math.max(0, Math.floor((to.getTime() - new Date(from).getTime()) / 60_000));
}

/** «8 мин», «2 ч 05 мин», «3 дн.» — сколько ждёт заявка. */
export function formatWait(minutes: number): string {
  if (minutes < 60) return `${minutes}${NBSP}мин`;
  if (minutes < 24 * 60) {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return m ? `${h}${NBSP}ч ${String(m).padStart(2, "0")}${NBSP}мин` : `${h}${NBSP}ч`;
  }
  const d = Math.floor(minutes / (24 * 60));
  return `${d}${NBSP}${plural(d, ["день", "дня", "дней"])}`;
}
