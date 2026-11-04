import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { ApiError } from "../../api/client";
import { applicationsApi } from "../../api/endpoints";
import { useCategories, useConditions, useMetals } from "../../api/queries";
import type {
  Application,
  ApplicationInput,
  Category,
  ItemCondition,
  Metal,
} from "../../api/types";
import { ItemArt } from "../../components/ItemArt";
import { Button } from "../../components/ui/Button";
import { Card, KeyValue, KeyValueList } from "../../components/ui/Card";
import { Alert, PageLoader } from "../../components/ui/Feedback";
import { ChoiceGroup, Field, Input, Segmented, Select, Textarea } from "../../components/ui/Form";
import { Icon } from "../../components/ui/Icon";
import { Stepper } from "../../components/ui/Stepper";
import { useToast } from "../../components/ui/Toast";
import { formatTenge, NBSP, parseWeight } from "../../lib/format";
import { formatTimeKz, isLowQuality, itemKind } from "./clientLib";
import { PhotoManager } from "./PhotoManager";
import styles from "./Client.module.css";

const STEPS = ["Изделие", "Параметры", "Фото", "Проверка"] as const;

const TITLE_PLACEHOLDER: Record<string, string> = {
  gold: "Например, кольцо с камнем",
  silver: "Например, серебряный браслет",
  platinum: "Например, обручальное кольцо",
  watches: "Например, часы Longines Master",
  electronics: "Например, iPhone 15 Pro 256 ГБ",
};

const BRAND_PLACEHOLDER: Record<string, string> = {
  watches: "Например, Seiko или Longines",
  electronics: "Например, Apple или Samsung",
};

interface Draft {
  categoryId: number | null;
  title: string;
  metal: Metal | null;
  fineness: string;
  weight: string;
  brand: string;
  condition: ItemCondition | "";
  description: string;
  requested: string;
}

const EMPTY: Draft = {
  categoryId: null,
  title: "",
  metal: null,
  fineness: "",
  weight: "",
  brand: "",
  condition: "",
  description: "",
  requested: "",
};

function fromApp(app: Application): Draft {
  return {
    categoryId: app.category.id,
    title: app.title,
    metal: app.metal,
    fineness: app.fineness ? String(app.fineness) : "",
    weight: app.weight_g ? String(app.weight_g).replace(".", ",") : "",
    brand: app.brand ?? "",
    condition: app.condition ?? "",
    description: app.description ?? "",
    requested: app.requested_amount ? String(Math.round(app.requested_amount / 100)) : "",
  };
}

/** Желаемая сумма в тенге → тиыны; пусто — null, мусор — undefined. */
function parseRequested(value: string): number | null | undefined {
  const s = value.replace(/\s/g, "");
  if (!s) return null;
  if (!/^\d{1,9}$/.test(s) || Number(s) === 0) return undefined;
  return Number(s) * 100;
}

function toInput(d: Draft, cat: Category): ApplicationInput {
  const metal = cat.requires_metal;
  return {
    category_id: cat.id,
    title: d.title.trim(),
    metal: metal ? d.metal : null,
    fineness: metal && d.fineness ? Number(d.fineness) : null,
    weight_g: metal ? parseWeight(d.weight) : null,
    brand: d.brand.trim() || null,
    condition: d.condition || null,
    description: d.description.trim() || null,
    requested_amount: parseRequested(d.requested) ?? null,
  };
}

type Errors = Partial<Record<keyof Draft | "photos" | "form", string>>;

const SERVER_FIELD: Record<string, keyof Draft | "photos"> = {
  category_id: "categoryId",
  title: "title",
  metal: "metal",
  fineness: "fineness",
  weight_g: "weight",
  brand: "brand",
  condition: "condition",
  description: "description",
  requested_amount: "requested",
  photos: "photos",
};

/** На каком шаге исправлять поле. */
const FIELD_STEP: Partial<Record<keyof Errors, number>> = {
  categoryId: 0,
  title: 0,
  photos: 2,
};

function serverErrors(err: unknown): Errors {
  if (!(err instanceof ApiError)) return { form: String(err) };
  const out: Errors = {};
  for (const f of err.fields) {
    const key = SERVER_FIELD[f.field];
    if (key) out[key] = f.message;
  }
  out.form = err.message;
  return out;
}

export function WizardPage() {
  const [params, setParams] = useSearchParams();
  const draftId = Number(params.get("draft")) || null;
  // черновик, созданный на этой странице, — тот же мастер: не перемонтируем и не грузим заново
  const createdHere = useRef<number | null>(null);
  const fresh = draftId !== null && draftId === createdHere.current;
  const existing = useQuery({
    queryKey: ["application", draftId],
    queryFn: () => applicationsApi.get(draftId!),
    enabled: draftId !== null && !fresh,
  });

  if (draftId !== null && !fresh && existing.isPending) return <PageLoader />;
  if (draftId !== null && !fresh && existing.isError) {
    return (
      <div className={styles.page}>
        <BackLink />
        <Alert tone="danger" title="Не удалось открыть заявку">
          {existing.error.message}
        </Alert>
      </div>
    );
  }
  const app = fresh ? null : (existing.data ?? null);
  if (app && !app.editable) {
    return (
      <div className={styles.page}>
        <BackLink />
        <Alert tone="info" title="Заявка уже на оценке">
          Изменить её сейчас нельзя.{" "}
          <Link to={`/client/applications/${app.id}`}>Открыть карточку заявки</Link>
        </Alert>
      </div>
    );
  }
  return (
    <Wizard
      key={fresh ? "new" : (app?.id ?? "new")}
      initial={app}
      onCreated={(id) => {
        createdHere.current = id;
        setParams({ draft: String(id) }, { replace: true });
      }}
    />
  );
}

function BackLink() {
  return (
    <Link to="/client" className={styles.back}>
      <Icon name="arrowLeft" size={18} />
      Мои заявки
    </Link>
  );
}

function Wizard({
  initial,
  onCreated,
}: {
  initial: Application | null;
  onCreated: (id: number) => void;
}) {
  const navigate = useNavigate();
  const toast = useToast();
  const queryClient = useQueryClient();
  const categories = useCategories();
  const metals = useMetals();
  const conditions = useConditions();

  const [app, setApp] = useState<Application | null>(initial);
  const [draft, setDraft] = useState<Draft>(initial ? fromApp(initial) : EMPTY);
  // черновик, который уже на сервере, открываем сразу на фото
  const [step, setStep] = useState(initial ? 2 : 0);
  const [errors, setErrors] = useState<Errors>({});
  const headingRef = useRef<HTMLHeadingElement>(null);
  const firstRender = useRef(true);

  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    headingRef.current?.focus();
  }, [step]);

  const category = categories.data?.find((c) => c.id === draft.categoryId) ?? null;
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    setDraft((d) => ({ ...d, [key]: value }));
    setErrors((e) => ({ ...e, [key]: undefined, form: undefined }));
  };

  const updateApp = (next: Application) => {
    setApp(next);
    queryClient.setQueryData(["application", next.id], next);
    void queryClient.invalidateQueries({ queryKey: ["applications"] });
    setErrors((e) => ({ ...e, photos: undefined }));
  };

  const save = useMutation({
    mutationFn: async () => {
      const input = toInput(draft, category!);
      if (app) return applicationsApi.update(app.id, input);
      return applicationsApi.create({ ...input, category_id: category!.id, title: input.title! });
    },
    onSuccess: (saved) => {
      const created = !app;
      updateApp(saved);
      if (created) onCreated(saved.id);
      setStep(2);
    },
    onError: (err) => setErrors(serverErrors(err)),
  });

  const submit = useMutation({
    mutationFn: () => applicationsApi.submit(app!.id),
    onSuccess: (sent) => {
      queryClient.setQueryData(["application", sent.id], sent);
      void queryClient.invalidateQueries({ queryKey: ["applications"] });
      void queryClient.invalidateQueries({ queryKey: ["notifications", "unread"] });
      toast.show({
        title: "Заявка отправлена",
        text: sent.pre_estimate ? "Предварительная оценка готова" : undefined,
      });
      navigate(`/client/applications/${sent.id}`);
    },
    onError: (err) => setErrors(serverErrors(err)),
  });

  const validate = (s: number): Errors => {
    const e: Errors = {};
    if (s === 0) {
      if (!category) e.categoryId = "Выберите, что вы хотите заложить";
      if (draft.title.trim().length < 2) e.title = "Назовите изделие — так его узнает эксперт";
    }
    if (s === 1 && category) {
      if (category.requires_metal) {
        if (!draft.metal) e.metal = "Выберите металл";
        if (!draft.fineness) e.fineness = "Укажите пробу — она выбита на клейме";
        if (!parseWeight(draft.weight)) e.weight = "Укажите вес в граммах, например 4,2";
      }
      if (!draft.condition) e.condition = "Выберите состояние";
      if (parseRequested(draft.requested) === undefined)
        e.requested = "Укажите сумму целым числом тенге";
    }
    if (s === 2 && app && app.photos.length === 0) e.photos = "Добавьте хотя бы одно фото";
    return e;
  };

  const next = (e?: FormEvent) => {
    e?.preventDefault();
    const problems = validate(step);
    setErrors(problems);
    if (Object.keys(problems).length) return;
    if (step === 1) save.mutate();
    else setStep(step + 1);
  };

  const pickCategory = (id: string) => {
    const cat = categories.data?.find((c) => String(c.id) === id);
    if (!cat) return;
    setDraft((d) => ({
      ...d,
      categoryId: cat.id,
      metal: cat.requires_metal
        ? cat.allowed_metals.includes(d.metal!)
          ? d.metal
          : (cat.allowed_metals[0] ?? null)
        : null,
      fineness: cat.requires_metal ? d.fineness : "",
    }));
    setErrors((e) => ({ ...e, categoryId: undefined }));
  };

  if (categories.isPending) return <PageLoader />;
  if (categories.isError)
    return (
      <div className={styles.page}>
        <BackLink />
        <Alert tone="danger" title="Не удалось загрузить категории">
          {categories.error.message}
        </Alert>
      </div>
    );

  const needInfo =
    app?.status === "NEED_INFO"
      ? [...app.history].reverse().find((h) => h.to_status === "NEED_INFO")
      : undefined;
  const metalInfo = metals.data?.find((m) => m.metal === draft.metal);

  return (
    <div className={styles.page}>
      <BackLink />
      <header className={styles.wizardHead}>
        <h1 className="t-h1">
          {app?.status === "NEED_INFO" ? "Дополнить заявку" : "Новая заявка"}
        </h1>
        {app && (
          <p className={styles.savedAt} role="status">
            Черновик сохранён в {formatTimeKz(app.updated_at)}
          </p>
        )}
      </header>
      <Stepper steps={STEPS} current={step} />

      {needInfo && (
        <Alert tone="warning" title="Эксперт просит дополнить заявку">
          {needInfo.comment ?? "Добавьте фото или уточните параметры и отправьте заявку снова."}
        </Alert>
      )}

      <div className={styles.split}>
        <Card as="section" pad="l" className={styles.wizardCard} aria-labelledby="wizard-step">
          <form onSubmit={next} noValidate className={styles.wizardForm}>
            {step === 0 && (
              <>
                <StepHead title="Что вы хотите заложить?">
                  От категории зависят доля от оценки, которую мы выдаём, и ставка.
                </StepHead>
                <ChoiceGroup
                  label="Категория"
                  showLabel={false}
                  value={draft.categoryId ? String(draft.categoryId) : null}
                  onChange={pickCategory}
                  error={errors.categoryId}
                  options={categories.data.map((c) => ({
                    value: String(c.id),
                    label: c.name,
                    note: `До ${c.ltv_percent}${NBSP}% от оценки`,
                  }))}
                />
                <Field
                  label="Название изделия"
                  error={errors.title}
                  hint="Как вы бы описали его в двух-трёх словах"
                >
                  {(p) => (
                    <Input
                      {...p}
                      value={draft.title}
                      maxLength={200}
                      placeholder={TITLE_PLACEHOLDER[category?.code ?? "gold"]}
                      onChange={(e) => set("title", e.target.value)}
                    />
                  )}
                </Field>
              </>
            )}

            {step === 1 && category && (
              <>
                <StepHead title="Параметры изделия">
                  {category.requires_metal
                    ? "Проба и вес — главное для оценки. Пробу ищите на клейме внутри изделия."
                    : "Бренд, модель и состояние помогут эксперту назвать точную сумму."}
                </StepHead>
                {category.requires_metal && (
                  <>
                    {category.allowed_metals.length > 1 && (
                      <div className={styles.fieldGroup}>
                        <span className={styles.groupLabel}>Металл</span>
                        <Segmented
                          label="Металл"
                          value={draft.metal ?? category.allowed_metals[0]!}
                          onChange={(m) => {
                            set("metal", m);
                            set("fineness", "");
                          }}
                          options={category.allowed_metals.map((m) => ({
                            value: m,
                            label: metals.data?.find((x) => x.metal === m)?.label ?? m,
                          }))}
                        />
                      </div>
                    )}
                    <div className={styles.row2}>
                      <Field label="Проба" error={errors.fineness ?? errors.metal}>
                        {(p) => (
                          <Select
                            {...p}
                            value={draft.fineness}
                            onChange={(e) => set("fineness", e.target.value)}
                          >
                            <option value="">Выберите пробу</option>
                            {metalInfo?.finenesses.map((f) => (
                              <option key={f} value={f}>
                                {f}
                              </option>
                            ))}
                          </Select>
                        )}
                      </Field>
                      <Field
                        label="Вес"
                        error={errors.weight}
                        hint="Без камней, если можете взвесить"
                      >
                        {(p) => (
                          <Input
                            {...p}
                            inputMode="decimal"
                            suffix="г"
                            value={draft.weight}
                            placeholder="4,2"
                            onChange={(e) => set("weight", e.target.value)}
                          />
                        )}
                      </Field>
                    </div>
                  </>
                )}
                <div className={styles.row2}>
                  <Field
                    label={category.requires_metal ? "Бренд (если есть)" : "Бренд и модель"}
                    error={errors.brand}
                  >
                    {(p) => (
                      <Input
                        {...p}
                        value={draft.brand}
                        maxLength={100}
                        placeholder={BRAND_PLACEHOLDER[category.code] ?? "Например, SOKOLOV"}
                        onChange={(e) => set("brand", e.target.value)}
                      />
                    )}
                  </Field>
                  <Field label="Состояние" error={errors.condition}>
                    {(p) => (
                      <Select
                        {...p}
                        value={draft.condition}
                        onChange={(e) => set("condition", e.target.value as ItemCondition)}
                      >
                        <option value="">Выберите состояние</option>
                        {conditions.data?.map((c) => (
                          <option key={c.condition} value={c.condition}>
                            {c.label}
                          </option>
                        ))}
                      </Select>
                    )}
                  </Field>
                </div>
                <Field
                  label="Описание"
                  hint="Камни, комплект, документы, дефекты — всё, что важно знать эксперту"
                  error={errors.description}
                >
                  {(p) => (
                    <Textarea
                      {...p}
                      value={draft.description}
                      maxLength={4000}
                      onChange={(e) => set("description", e.target.value)}
                    />
                  )}
                </Field>
                <Field
                  label="Желаемая сумма займа"
                  hint="Необязательно. Эксперт учтёт её, если оценка позволит"
                  error={errors.requested}
                  className={styles.narrow}
                >
                  {(p) => (
                    <Input
                      {...p}
                      inputMode="numeric"
                      suffix="₸"
                      value={draft.requested}
                      placeholder="80 000"
                      onChange={(e) => set("requested", e.target.value)}
                    />
                  )}
                </Field>
              </>
            )}

            {step === 2 && app && (
              <>
                <StepHead
                  title="Фотографии изделия"
                  aside={`${app.photos.length} из ${app.max_photos}`}
                >
                  Загрузите от 1 до {app.max_photos} снимков. Чем лучше видны клеймо и камни, тем
                  точнее предварительная оценка.
                </StepHead>
                <PhotoManager app={app} onChange={updateApp} />
                {errors.photos && (
                  <p className={styles.fieldError} role="alert">
                    {errors.photos}
                  </p>
                )}
                <PhotoTips />
              </>
            )}

            {step === 3 && app && category && (
              <>
                <StepHead title="Проверьте заявку">
                  После отправки мы сразу посчитаем предварительную оценку, а эксперт пришлёт
                  предложение.
                </StepHead>
                <ul className={styles.reviewPhotos} role="list" aria-label="Фото заявки">
                  {app.photos.map((p, i) => (
                    <li key={p.id}>
                      <img src={p.thumb_url} alt={`Фото ${i + 1}`} />
                    </li>
                  ))}
                </ul>
                <Summary
                  app={app}
                  draft={draft}
                  category={category}
                  metalLabel={metalInfo?.label}
                  conditionLabel={
                    conditions.data?.find((c) => c.condition === draft.condition)?.label
                  }
                />
                <p className={styles.muted}>
                  Отправляя заявку, вы ничего не подписываете: решение о займе примете после
                  предложения эксперта.
                </p>
              </>
            )}

            {errors.form && (
              <Alert tone="danger" title={errors.form}>
                {Object.entries(errors)
                  .filter(([k, v]) => k !== "form" && v)
                  .map(([k, v]) => (
                    <span key={k} className={styles.problem}>
                      {v}{" "}
                      <button
                        type="button"
                        className={styles.inlineLink}
                        onClick={() => setStep(FIELD_STEP[k as keyof Errors] ?? 1)}
                      >
                        Исправить
                      </button>
                    </span>
                  ))}
              </Alert>
            )}

            <footer className={styles.wizardFoot}>
              {step > 0 ? (
                <Button variant="secondary" onClick={() => setStep(step - 1)}>
                  Назад
                </Button>
              ) : (
                <span />
              )}
              {step < 3 ? (
                <Button
                  type="submit"
                  loading={save.isPending}
                  disabled={step === 2 && !app?.photos.length}
                >
                  {step === 2 ? "Перейти к проверке" : "Далее"}
                </Button>
              ) : (
                <Button loading={submit.isPending} onClick={() => submit.mutate()}>
                  {app?.status === "NEED_INFO" ? "Отправить повторно" : "Отправить на оценку"}
                </Button>
              )}
            </footer>
          </form>
          <span id="wizard-step" className="visually-hidden" ref={headingRef} tabIndex={-1}>
            Шаг {step + 1} из {STEPS.length}: {STEPS[step]}
          </span>
        </Card>

        <aside className={styles.side}>
          {category && step > 0 && (
            <Card pad="l" className={styles.sideCard}>
              <div className={styles.sideHead}>
                <h2 className="t-h3">Ваша заявка</h2>
                {step > 1 && (
                  <button type="button" className={styles.inlineLink} onClick={() => setStep(1)}>
                    Изменить
                  </button>
                )}
              </div>
              <div className={styles.itemBrief}>
                <span className={styles.briefThumb}>
                  {app?.photos[0] ? (
                    <img src={app.photos[0].thumb_url} alt="" />
                  ) : (
                    <ItemArt kind={itemKind(category.code)} square />
                  )}
                </span>
                <span>
                  <span className={styles.briefTitle}>{draft.title || "Без названия"}</span>
                  <span className={styles.briefMeta}>{category.name}</span>
                </span>
              </div>
              <ParamList
                draft={draft}
                category={category}
                metalLabel={metalInfo?.label}
                conditionLabel={
                  conditions.data?.find((c) => c.condition === draft.condition)?.label
                }
              />
            </Card>
          )}
          {step === 2 && app && <PhotoCheck app={app} />}
          {step === 0 && <CategoryHint />}
        </aside>
      </div>
    </div>
  );
}

function StepHead({
  title,
  aside,
  children,
}: {
  title: string;
  aside?: string;
  children: ReactNode;
}) {
  return (
    <div className={styles.stepHead}>
      <div className={styles.stepTitleRow}>
        <h2 className="t-h3">{title}</h2>
        {aside && <span className={styles.stepAside}>{aside}</span>}
      </div>
      <p className={styles.stepLead}>{children}</p>
    </div>
  );
}

function ParamList({
  draft,
  category,
  metalLabel,
  conditionLabel,
}: {
  draft: Draft;
  category: Category;
  metalLabel?: string;
  conditionLabel?: string;
}) {
  const weight = parseWeight(draft.weight);
  const requested = parseRequested(draft.requested);
  return (
    <KeyValueList>
      {category.requires_metal && metalLabel && <KeyValue label="Металл" value={metalLabel} />}
      {category.requires_metal && draft.fineness && (
        <KeyValue label="Проба" value={draft.fineness} />
      )}
      {category.requires_metal && weight && (
        <KeyValue label="Вес" value={`${String(weight).replace(".", ",")}${NBSP}г`} />
      )}
      {draft.brand.trim() && <KeyValue label="Бренд" value={draft.brand.trim()} />}
      {conditionLabel && <KeyValue label="Состояние" value={conditionLabel} />}
      {requested ? <KeyValue label="Желаемая сумма" value={formatTenge(requested)} /> : null}
    </KeyValueList>
  );
}

function Summary(props: {
  app: Application;
  draft: Draft;
  category: Category;
  metalLabel?: string;
  conditionLabel?: string;
}) {
  const { draft, category } = props;
  return (
    <div className={styles.summary}>
      <KeyValueList>
        <KeyValue label="Изделие" value={draft.title} />
        <KeyValue label="Категория" value={category.name} />
      </KeyValueList>
      <ParamList {...props} />
      {draft.description.trim() && <p className={styles.summaryText}>{draft.description.trim()}</p>}
    </div>
  );
}

const TIPS: { icon: "sun" | "zoom" | "grid"; title: string; text: string }[] = [
  { icon: "sun", title: "Дневной свет", text: "Без вспышки и резких теней" },
  { icon: "zoom", title: "Клеймо крупно", text: "Проба должна читаться" },
  { icon: "grid", title: "Однотонный фон", text: "Белый лист или ткань" },
];

function PhotoTips() {
  return (
    <section className={styles.tips} aria-labelledby="photo-tips">
      <h3 id="photo-tips" className="t-h4">
        Как снять, чтобы оценка была точнее
      </h3>
      <ul role="list">
        {TIPS.map((t) => (
          <li key={t.title}>
            <Icon name={t.icon} size={22} className={styles.tipIcon} />
            <span>
              <strong>{t.title}</strong>
              <span>{t.text}</span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function PhotoCheck({ app }: { app: Application }) {
  const items = useMemo(() => {
    const out: { ok: boolean; text: string }[] = [];
    const n = app.photos.length;
    out.push({
      ok: n > 0,
      text: n ? `Загружено ${n} фото из ${app.max_photos}` : "Пока нет ни одного фото",
    });
    out.push({
      ok: n >= 3,
      text:
        n >= 3
          ? "Изделие снято с разных сторон"
          : "Лучше 3 снимка и больше: общий вид, клеймо, сбоку",
    });
    app.photos.forEach((p, i) => {
      if (isLowQuality(p)) out.push({ ok: false, text: `Фото ${i + 1} — низкое качество` });
    });
    return out;
  }, [app]);
  return (
    <Card pad="l" className={styles.sideCard}>
      <h2 className="t-h3">Проверка фото</h2>
      <p className={styles.sideNote}>Автоматически, до отправки эксперту</p>
      <ul className={styles.checks} role="list">
        {items.map((it) => (
          <li key={it.text} data-ok={it.ok || undefined}>
            <Icon name={it.ok ? "check" : "alert"} size={18} strokeWidth={2} />
            {it.text}
          </li>
        ))}
      </ul>
    </Card>
  );
}

function CategoryHint() {
  return (
    <Card pad="l" className={styles.sideCard}>
      <h2 className="t-h3">Как это работает</h2>
      <ol className={styles.howList}>
        <li>Опишите изделие и сфотографируйте его — это 3–5 минут.</li>
        <li>Предварительная оценка придёт сразу, предложение эксперта — в течение часа.</li>
        <li>Курьер заберёт изделие, после осмотра деньги придут на карту.</li>
      </ol>
    </Card>
  );
}
