import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { ApiError } from "../../api/client";
import { calculatorApi } from "../../api/endpoints";
import { useCategories, useConditions, useMetals } from "../../api/queries";
import type { CalculatorInput, Category, ItemCondition } from "../../api/types";
import { Hallmark } from "../../components/ui/Brand";
import { ButtonLink } from "../../components/ui/Button";
import { Card, KeyValue, KeyValueList } from "../../components/ui/Card";
import { Alert, Spinner } from "../../components/ui/Feedback";
import { Field, Input, Segmented, Select, Slider } from "../../components/ui/Form";
import {
  days,
  formatDate,
  formatTenge,
  formatTengeRange,
  NBSP,
  parseWeight,
} from "../../lib/format";
import { useDebounced } from "../../lib/useDebounced";
import styles from "./Landing.module.css";

/** Категории калькулятора на лэндинге — в порядке макета. */
const TABS: { code: string; label: string; short?: string }[] = [
  { code: "gold", label: "Золото" },
  { code: "watches", label: "Часы" },
  { code: "electronics", label: "Электроника", short: "Техника" },
  { code: "silver", label: "Серебро" },
];

interface Params {
  fineness: number | null;
  weight: string;
  brand: string;
  condition: ItemCondition;
}

const DEFAULTS: Record<string, Params> = {
  gold: { fineness: 585, weight: "4,2", brand: "", condition: "GOOD" },
  silver: { fineness: 925, weight: "20", brand: "", condition: "GOOD" },
  watches: { fineness: null, weight: "", brand: "", condition: "GOOD" },
  electronics: { fineness: null, weight: "", brand: "", condition: "GOOD" },
};

const BRAND_PLACEHOLDER: Record<string, string> = {
  watches: "Например, Seiko или Longines",
  electronics: "Например, Apple или Samsung",
};

const DEFAULT_TERM = 30;

function buildInput(cat: Category, p: Params, term: number): CalculatorInput | null {
  const input: CalculatorInput = { category_code: cat.code, term_days: term };
  if (cat.requires_metal) {
    const weight = parseWeight(p.weight);
    if (!weight || !p.fineness) return null;
    Object.assign(input, { metal: cat.allowed_metals[0], fineness: p.fineness, weight_g: weight });
  } else {
    if (p.brand.trim()) input.brand = p.brand.trim();
    input.condition = p.condition;
  }
  return input;
}

interface Props {
  /** Куда ведёт кнопка «Оценить по фото». */
  ctaTo: string;
  /** Заголовок и вводный текст над формой (левая колонка). */
  intro?: ReactNode;
}

export function LoanCalculator({ ctaTo, intro }: Props) {
  const categories = useCategories();
  const metals = useMetals();
  const conditions = useConditions();

  const tabs = useMemo(
    () => TABS.filter((t) => categories.data?.some((c) => c.code === t.code && c.ltv_percent > 0)),
    [categories.data],
  );
  const [code, setCode] = useState("gold");
  const [params, setParams] = useState<Record<string, Params>>(DEFAULTS);
  const [term, setTerm] = useState(DEFAULT_TERM);

  const category = categories.data?.find((c) => c.code === code) ?? null;
  const p = params[code] ?? DEFAULTS.gold!;
  const termDays = category
    ? Math.min(Math.max(term, category.min_term_days), category.max_term_days)
    : term;
  const finenesses = category?.requires_metal
    ? (metals.data?.find((m) => m.metal === category.allowed_metals[0])?.finenesses ?? [])
    : [];

  const update = (patch: Partial<Params>) =>
    setParams((all) => ({ ...all, [code]: { ...p, ...patch } }));

  const weightError =
    category?.requires_metal && parseWeight(p.weight) === null
      ? "Укажите вес в граммах, например 4,2"
      : undefined;

  const input = category ? buildInput(category, p, termDays) : null;
  // Дебаунс по строке: объект input пересоздаётся на каждом рендере.
  const inputKey = input ? JSON.stringify(input) : null;
  const debouncedKey = useDebounced(inputKey, 250);
  const debounced = useMemo(
    () => (debouncedKey ? (JSON.parse(debouncedKey) as CalculatorInput) : null),
    [debouncedKey],
  );
  const result = useQuery({
    queryKey: ["calculator", debounced],
    queryFn: ({ signal }) => calculatorApi.calculate(debounced!, signal),
    enabled: debounced !== null,
    placeholderData: keepPreviousData,
    staleTime: 60_000,
    retry: false,
  });
  const data = result.data;
  const stale = result.isFetching || debouncedKey !== inputKey;

  if (categories.isError) {
    return (
      <Alert tone="danger" title="Калькулятор недоступен">
        {categories.error instanceof ApiError
          ? categories.error.message
          : "Не удалось загрузить условия займа."}{" "}
        Обновите страницу через минуту.
      </Alert>
    );
  }

  return (
    <div className={styles.calcGrid}>
      <div className={styles.calcLeft}>
        {intro}
        <form
          className={styles.calcForm}
          onSubmit={(e) => e.preventDefault()}
          aria-label="Параметры расчёта"
        >
          <div className={styles.calcField}>
            <span className={styles.fieldCaption} id="calc-kind">
              Что закладываете
            </span>
            <Segmented
              label="Что закладываете"
              value={code}
              onChange={setCode}
              options={tabs.map((t) => ({
                value: t.code,
                label: t.short ? (
                  <>
                    <span className={styles.long}>{t.label}</span>
                    <span className={styles.short}>{t.short}</span>
                  </>
                ) : (
                  t.label
                ),
              }))}
            />
          </div>

          {category?.requires_metal ? (
            <div className={styles.calcRow}>
              <Field label="Проба">
                {(f) => (
                  <Select
                    {...f}
                    value={p.fineness ?? ""}
                    onChange={(e) => update({ fineness: Number(e.target.value) })}
                  >
                    {finenesses.map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field label="Вес" error={weightError}>
                {(f) => (
                  <Input
                    {...f}
                    inputMode="decimal"
                    suffix="г"
                    value={p.weight}
                    onChange={(e) => update({ weight: e.target.value })}
                    autoComplete="off"
                  />
                )}
              </Field>
            </div>
          ) : (
            <div className={styles.calcRow}>
              <Field label="Бренд" hint="Если бренда нет в справочнике, посчитаем по средней цене">
                {(f) => (
                  <Input
                    {...f}
                    value={p.brand}
                    placeholder={BRAND_PLACEHOLDER[code]}
                    onChange={(e) => update({ brand: e.target.value })}
                    autoComplete="off"
                  />
                )}
              </Field>
              <Field label="Состояние">
                {(f) => (
                  <Select
                    {...f}
                    value={p.condition}
                    onChange={(e) => update({ condition: e.target.value as ItemCondition })}
                  >
                    {(conditions.data ?? [{ condition: "GOOD", label: "Хорошее" }]).map((c) => (
                      <option key={c.condition} value={c.condition}>
                        {c.label}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            </div>
          )}

          <Field label="Срок займа" aside={days(termDays)}>
            {(f) => (
              <Slider
                {...f}
                min={category?.min_term_days ?? 7}
                max={category?.max_term_days ?? 60}
                value={termDays}
                onChange={setTerm}
                minLabel={days(category?.min_term_days ?? 7)}
                maxLabel={days(category?.max_term_days ?? 60)}
                aria-valuetext={days(termDays)}
              />
            )}
          </Field>
        </form>
      </div>

      <Card as="aside" pad="l" className={styles.calcResult} aria-live="polite" aria-busy={stale}>
        <div className={styles.calcHead}>
          <div>
            <p className={styles.resultCaption}>Сумма займа</p>
            <p className={styles.amountXl} data-stale={stale || undefined}>
              {data ? formatTenge(data.quote.loan_amount) : `—${NBSP}₸`}
            </p>
          </div>
          {category?.requires_metal && p.fineness ? (
            <Hallmark tone={code === "gold" ? "gold" : "silver"} label={`Проба ${p.fineness}`}>
              {String(p.fineness)}
            </Hallmark>
          ) : (
            result.isFetching && <Spinner label="Считаем" />
          )}
        </div>

        {result.isError && !data ? (
          <Alert tone="warning" title="Не получилось посчитать">
            {result.error instanceof ApiError
              ? result.error.message
              : "Попробуйте изменить параметры."}
          </Alert>
        ) : (
          <KeyValueList>
            <KeyValue
              label="Оценка изделия"
              value={data ? formatTengeRange(data.value_min, data.value_max) : "—"}
            />
            <KeyValue label="Доля от оценки" value={data ? `${data.ltv_percent}${NBSP}%` : "—"} />
            <KeyValue label="Ставка" value={data ? data.quote.rate_label : "—"} />
            <KeyValue
              label={`Проценты за ${days(termDays)}`}
              value={data ? formatTenge(data.quote.interest) : "—"}
            />
            <KeyValue
              label={data ? `Вернуть ${formatDate(data.quote.due_date)}` : "Вернуть"}
              value={data ? formatTenge(data.quote.total_to_repay) : "—"}
              emphasis
            />
          </KeyValueList>
        )}

        <ButtonLink to={ctaTo} icon="camera" size="l" block>
          Оценить по фото
        </ButtonLink>
      </Card>
    </div>
  );
}
