import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { FormEvent } from "react";
import { ApiError } from "../../api/client";
import { adminApi } from "../../api/endpoints";
import type { AdminCategory, CategoryCreate, Metal } from "../../api/types";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { Alert, Badge, PageLoader } from "../../components/ui/Feedback";
import { Checkbox, Field, Input, Select } from "../../components/ui/Form";
import { Modal } from "../../components/ui/Modal";
import { useToast } from "../../components/ui/Toast";
import { formatRate, formatTenge, NBSP } from "../../lib/format";
import { formatDateTimeKz } from "../../lib/time";
import {
  formatTengeInput,
  parseRateInput,
  parseTengeInput,
  rateInputValue,
} from "../expert/expertLib";
import { formatChange, METAL_LABEL, metalRows } from "./adminLib";
import styles from "./Admin.module.css";

export function CatalogPage() {
  return (
    <div className={styles.page}>
      <header className={styles.pageHead}>
        <div>
          <h1 className="t-h1">Справочники</h1>
          <p className={styles.subline}>
            Условия займа по категориям и цены металлов. Новые условия действуют для следующих
            предложений экспертов; выданные займы не меняются.
          </p>
        </div>
      </header>
      <Categories />
      <MetalPrices />
    </div>
  );
}

// ---------- категории ----------

interface CategoryDraft {
  code: string;
  name: string;
  ltv: string;
  rate: string;
  minTerm: string;
  maxTerm: string;
  requiresMetal: boolean;
  active: boolean;
}

const toDraft = (c?: AdminCategory): CategoryDraft => ({
  code: c?.code ?? "",
  name: c?.name ?? "",
  ltv: c ? String(c.ltv_percent) : "",
  rate: c ? rateInputValue(c.daily_rate_bp) : "",
  minTerm: String(c?.min_term_days ?? 7),
  maxTerm: String(c?.max_term_days ?? 60),
  requiresMetal: c?.requires_metal ?? false,
  active: c?.is_active ?? true,
});

type Errors = Partial<Record<keyof CategoryDraft, string>>;

function validateCategory(d: CategoryDraft, isNew: boolean): Errors {
  const e: Errors = {};
  if (isNew && !/^[a-z][a-z0-9_]{1,49}$/.test(d.code))
    e.code = "Латиница, цифры и «_», начиная с буквы: например, furs";
  if (d.name.trim().length < 2) e.name = "Укажите название";
  const ltv = Number(d.ltv);
  if (!Number.isInteger(ltv) || ltv < 1 || ltv > 100) e.ltv = "От 1 до 100 %";
  const bp = parseRateInput(d.rate);
  if (!bp || bp > 1000) e.rate = "От 0,01 до 10 % в день";
  const min = Number(d.minTerm);
  const max = Number(d.maxTerm);
  if (!Number.isInteger(min) || min < 1 || min > 365) e.minTerm = "От 1 до 365 дней";
  if (!Number.isInteger(max) || max < 1 || max > 365) e.maxTerm = "От 1 до 365 дней";
  else if (!e.minTerm && max < min) e.maxTerm = "Не меньше минимального";
  return e;
}

function Categories() {
  const categories = useQuery({ queryKey: ["admin", "categories"], queryFn: adminApi.categories });
  const [editing, setEditing] = useState<AdminCategory | "new" | null>(null);

  return (
    <Card as="section" pad="l" className={styles.panel} aria-labelledby="cat-title">
      <div className={styles.panelHead}>
        <h2 id="cat-title" className="t-h3">
          Категории и ставки
        </h2>
        <Button variant="secondary" size="s" icon="plus" onClick={() => setEditing("new")}>
          Добавить категорию
        </Button>
      </div>
      {categories.isPending ? (
        <PageLoader />
      ) : categories.isError ? (
        <Alert tone="danger" title="Не удалось загрузить категории">
          {categories.error.message}
        </Alert>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">Категория</th>
                <th scope="col" className={styles.num}>
                  Доля от оценки
                </th>
                <th scope="col" className={styles.num}>
                  Ставка в день
                </th>
                <th scope="col">Срок</th>
                <th scope="col">Статус</th>
                <th scope="col">
                  <span className="visually-hidden">Действия</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {categories.data.map((c) => (
                <tr key={c.id} data-muted={!c.is_active || undefined}>
                  <td>
                    <strong>{c.name}</strong>
                    <span className={styles.cellSub}>
                      {c.code}
                      {c.requires_metal ? ", с пробой и весом" : ""}
                    </span>
                  </td>
                  <td className={styles.num}>
                    {c.ltv_percent}
                    {NBSP}%
                  </td>
                  <td className={styles.num}>{formatRate(c.daily_rate_bp)}</td>
                  <td className={styles.nowrap}>
                    {c.min_term_days}–{c.max_term_days}
                    {NBSP}дней
                  </td>
                  <td>
                    <Badge tone={c.is_active ? "success" : "neutral"}>
                      {c.is_active ? "Принимаем" : "Скрыта"}
                    </Badge>
                  </td>
                  <td className={styles.rowAction}>
                    <Button
                      variant="ghost"
                      size="s"
                      onClick={() => setEditing(c)}
                      aria-label={`Изменить категорию «${c.name}»`}
                    >
                      Изменить
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing && (
        <CategoryDialog
          category={editing === "new" ? undefined : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </Card>
  );
}

function CategoryDialog({ category, onClose }: { category?: AdminCategory; onClose: () => void }) {
  const isNew = !category;
  const [d, setD] = useState(() => toDraft(category));
  const [errors, setErrors] = useState<Errors>({});
  const queryClient = useQueryClient();
  const toast = useToast();
  const save = useMutation({
    mutationFn: () => {
      const body: CategoryCreate = {
        code: d.code,
        name: d.name.trim(),
        ltv_percent: Number(d.ltv),
        daily_rate_bp: parseRateInput(d.rate)!,
        min_term_days: Number(d.minTerm),
        max_term_days: Number(d.maxTerm),
        requires_metal: d.requiresMetal,
      };
      if (isNew) return adminApi.createCategory(body);
      return adminApi.updateCategory(category.id, {
        name: body.name,
        ltv_percent: body.ltv_percent,
        daily_rate_bp: body.daily_rate_bp,
        min_term_days: body.min_term_days,
        max_term_days: body.max_term_days,
        is_active: d.active,
      });
    },
    onSuccess: (c) => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "categories"] });
      void queryClient.invalidateQueries({ queryKey: ["catalog"] });
      toast.show({ title: isNew ? `Категория «${c.name}» добавлена` : "Условия сохранены" });
      onClose();
    },
    onError: (e) => {
      if (e instanceof ApiError)
        setErrors({
          code: e.fieldMessage("code"),
          name: e.fieldMessage("name"),
          ltv: e.fieldMessage("ltv_percent"),
          rate: e.fieldMessage("daily_rate_bp"),
          maxTerm: e.fieldMessage("max_term_days"),
        });
    },
  });
  const set = <K extends keyof CategoryDraft>(k: K, v: CategoryDraft[K]) => {
    setD((prev) => ({ ...prev, [k]: v }));
    setErrors((prev) => ({ ...prev, [k]: undefined }));
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const problems = validateCategory(d, isNew);
    setErrors(problems);
    if (Object.keys(problems).length === 0) save.mutate();
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={isNew ? "Новая категория" : `Категория «${category.name}»`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Отмена
          </Button>
          <Button type="submit" form="category-form" loading={save.isPending}>
            {isNew ? "Добавить категорию" : "Сохранить"}
          </Button>
        </>
      }
    >
      <form id="category-form" onSubmit={submit} noValidate className={styles.modalForm}>
        {isNew && (
          <Field label="Код" hint="Латиницей, для адресов и отчётов" error={errors.code}>
            {(p) => (
              <Input {...p} value={d.code} onChange={(e) => set("code", e.target.value.trim())} />
            )}
          </Field>
        )}
        <Field label="Название" error={errors.name}>
          {(p) => <Input {...p} value={d.name} onChange={(e) => set("name", e.target.value)} />}
        </Field>
        <div className={styles.row2}>
          <Field label="Доля от оценки" error={errors.ltv}>
            {(p) => (
              <Input
                {...p}
                inputMode="numeric"
                suffix="%"
                value={d.ltv}
                onChange={(e) => set("ltv", e.target.value.replace(/\D/g, "").slice(0, 3))}
              />
            )}
          </Field>
          <Field label="Ставка" error={errors.rate}>
            {(p) => (
              <Input
                {...p}
                inputMode="decimal"
                suffix="% в день"
                value={d.rate}
                onChange={(e) => set("rate", e.target.value)}
              />
            )}
          </Field>
          <Field label="Срок от" error={errors.minTerm}>
            {(p) => (
              <Input
                {...p}
                inputMode="numeric"
                suffix="дней"
                value={d.minTerm}
                onChange={(e) => set("minTerm", e.target.value.replace(/\D/g, "").slice(0, 3))}
              />
            )}
          </Field>
          <Field label="Срок до" error={errors.maxTerm}>
            {(p) => (
              <Input
                {...p}
                inputMode="numeric"
                suffix="дней"
                value={d.maxTerm}
                onChange={(e) => set("maxTerm", e.target.value.replace(/\D/g, "").slice(0, 3))}
              />
            )}
          </Field>
        </div>
        {isNew ? (
          <Checkbox
            label="Изделия из драгметалла: клиент указывает пробу и вес"
            checked={d.requiresMetal}
            onChange={(e) => set("requiresMetal", e.target.checked)}
          />
        ) : (
          <Checkbox
            label="Принимаем в залог — категория видна клиентам"
            checked={d.active}
            onChange={(e) => set("active", e.target.checked)}
          />
        )}
        {save.isError && (
          <Alert tone="danger" title="Не сохранено">
            {save.error.message}
          </Alert>
        )}
      </form>
    </Modal>
  );
}

// ---------- цены металлов ----------

const METALS: Metal[] = ["GOLD", "SILVER", "PLATINUM", "PALLADIUM"];

function MetalPrices() {
  const prices = useQuery({ queryKey: ["admin", "metal-prices"], queryFn: adminApi.metalPrices });
  const [metal, setMetal] = useState<Metal>("GOLD");
  const [price, setPrice] = useState("");
  const [error, setError] = useState<string>();
  const queryClient = useQueryClient();
  const toast = useToast();
  const save = useMutation({
    mutationFn: (tiyn: number) => adminApi.createMetalPrice(metal, tiyn),
    onSuccess: (p) => {
      setPrice("");
      void queryClient.invalidateQueries({ queryKey: ["admin", "metal-prices"] });
      void queryClient.invalidateQueries({ queryKey: ["catalog"] });
      toast.show({
        title: `${METAL_LABEL[p.metal]}: ${formatTenge(p.price_per_gram)} за грамм`,
        text: "Новая цена уже используется в предоценке",
      });
    },
    onError: (e) => setError(e.message),
  });
  const rows = metalRows(prices.data ?? []);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const tiyn = parseTengeInput(price);
    if (!tiyn) {
      setError("Введите цену за грамм в тенге");
      return;
    }
    save.mutate(tiyn);
  };

  return (
    <Card as="section" pad="l" className={styles.panel} id="metals" aria-labelledby="metals-title">
      <div>
        <h2 id="metals-title" className="t-h3">
          Цены металлов
        </h2>
        <p className={styles.caption}>
          За грамм металла 999 пробы. Цена другой пробы считается пропорционально.
        </p>
      </div>
      {prices.isPending ? (
        <PageLoader />
      ) : prices.isError ? (
        <Alert tone="danger" title="Не удалось загрузить цены">
          {prices.error.message}
        </Alert>
      ) : (
        <>
          <dl className={styles.metalTiles}>
            {rows.map((r) => (
              <div key={r.metal}>
                <dt>{METAL_LABEL[r.metal]}</dt>
                <dd className={styles.metalPrice}>{formatTenge(r.current.price_per_gram)}</dd>
                <dd className={styles.cellSub}>
                  {r.change !== null && (
                    <span data-trend={r.change >= 0 ? "up" : "down"}>
                      {formatChange(r.change)}{" "}
                    </span>
                  )}
                  с {formatDateTimeKz(r.current.effective_from)}
                </dd>
              </div>
            ))}
          </dl>
          <form onSubmit={submit} noValidate className={styles.priceForm}>
            <Field label="Металл">
              {(p) => (
                <Select {...p} value={metal} onChange={(e) => setMetal(e.target.value as Metal)}>
                  {METALS.map((m) => (
                    <option key={m} value={m}>
                      {METAL_LABEL[m]}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Новая цена за грамм" error={error}>
              {(p) => (
                <Input
                  {...p}
                  inputMode="numeric"
                  suffix="₸"
                  value={price}
                  onChange={(e) => {
                    setPrice(formatTengeInput(e.target.value));
                    setError(undefined);
                  }}
                />
              )}
            </Field>
            <Button type="submit" loading={save.isPending}>
              Сохранить цену
            </Button>
          </form>
          <details className={styles.history}>
            <summary>История цен</summary>
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th scope="col">Металл</th>
                    <th scope="col" className={styles.num}>
                      За грамм
                    </th>
                    <th scope="col">Действует с</th>
                    <th scope="col">Источник</th>
                  </tr>
                </thead>
                <tbody>
                  {prices.data.slice(0, 20).map((p) => (
                    <tr key={p.id}>
                      <td>
                        {METAL_LABEL[p.metal]}
                        {p.is_current && <span className={styles.cellSub}>действует</span>}
                      </td>
                      <td className={styles.num}>{formatTenge(p.price_per_gram)}</td>
                      <td>{formatDateTimeKz(p.effective_from)}</td>
                      <td>{p.source === "manual" ? "Вручную" : p.source}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </>
      )}
    </Card>
  );
}
