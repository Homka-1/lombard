/** Форматирование для Казахстана: тенге (суммы приходят в тиынах), телефоны +7 7XX, даты. */

export const NBSP = String.fromCharCode(0xa0); // неразрывный пробел

function groupDigits(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
}

/** 9 520 000 тиын → «95 200 ₸». Тиыны показываются, только если они есть. */
export function formatTenge(tiyn: number, opts: { sign?: boolean } = {}): string {
  const negative = tiyn < 0;
  const abs = Math.abs(Math.round(tiyn));
  const whole = Math.floor(abs / 100);
  const frac = abs % 100;
  let s = groupDigits(whole);
  if (frac) s += `,${String(frac).padStart(2, "0")}`;
  if (opts.sign === false) return (negative ? "−" : "") + s;
  return `${negative ? "−" : ""}${s}${NBSP}₸`;
}

/** Диапазон оценки: «112 000 – 127 000 ₸». */
export function formatTengeRange(min: number, max: number): string {
  if (min === max) return formatTenge(min);
  return `${formatTenge(min, { sign: false })}${NBSP}–${NBSP}${formatTenge(max)}`;
}

/** Ставка в базисных пунктах в день: 25 → «0,25 %». */
export function formatRate(bp: number): string {
  return `${(bp / 100).toLocaleString("ru-RU", { maximumFractionDigits: 2 })}${NBSP}%`;
}

const PLURAL = new Intl.PluralRules("ru-RU");

/** plural(5, ["день", "дня", "дней"]) → «дней». */
export function plural(
  n: number,
  forms: readonly [one: string, few: string, many: string],
): string {
  const rule = PLURAL.select(n);
  if (rule === "one") return forms[0];
  if (rule === "few") return forms[1];
  return forms[2];
}

export const days = (n: number) => `${n}${NBSP}${plural(n, ["день", "дня", "дней"])}`;

/** «2026-12-04» → «4 декабря» (год — если не текущий). Дата без времени не сдвигается по поясу. */
export function formatDate(value: string | Date, now: Date = new Date()): string {
  const d =
    typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
      ? new Date(`${value}T12:00:00`)
      : new Date(value);
  const sameYear = d.getFullYear() === now.getFullYear();
  return d
    .toLocaleDateString("ru-RU", {
      day: "numeric",
      month: "long",
      ...(sameYear ? {} : { year: "numeric" }),
    })
    .replace(/\s?г\.$/, "");
}

/**
 * Десять цифр номера без кода страны: «+7 701 123-45-67» → «7011234567».
 * Ведущая 7 — код страны, если номер введён с «+7» или в нём 11 цифр; ведущая 8 — всегда.
 */
export function phoneDigits(input: string): string {
  let d = input.replace(/\D/g, "");
  const withCountry = input.trim().startsWith("+");
  // «+7…», «8…» (межгород) и 11 цифр с ведущей 7/8 — первая цифра означает код страны.
  if (
    (withCountry && d.startsWith("7")) ||
    d.startsWith("8") ||
    (d.length >= 11 && d.startsWith("7"))
  )
    d = d.slice(1);
  return d.slice(0, 10);
}

/** Маска ввода: «7011234» → «+7 701 123-4»; пустое поле остаётся пустым. */
export function formatPhoneInput(input: string): string {
  const d = phoneDigits(input);
  if (d === "") return "";
  let s = `+7 ${d.slice(0, 3)}`;
  if (d.length > 3) s += ` ${d.slice(3, 6)}`;
  if (d.length > 6) s += `-${d.slice(6, 8)}`;
  if (d.length > 8) s += `-${d.slice(8, 10)}`;
  return s;
}

/** «Айгерим Садыкова» → «АС». */
export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
}

/** Вес в граммах из поля ввода: «4,2» → 4.2 (до 3 знаков); пусто или вне 0–10 000 → null. */
export function parseWeight(value: string): number | null {
  const s = value.replace(",", ".").replace(/\s/g, "");
  if (!/^\d+(\.\d*)?$/.test(s)) return null;
  const n = Number(s);
  return n > 0 && n <= 10_000 ? Math.round(n * 1000) / 1000 : null;
}
