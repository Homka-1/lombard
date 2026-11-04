import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import { ApiError } from "../../api/client";
import { applicationsApi, expertApi } from "../../api/endpoints";
import { useCategories } from "../../api/queries";
import type { Application, Category, InspectionInput, OfferTerms } from "../../api/types";
import { Button } from "../../components/ui/Button";
import { Card, KeyValue, KeyValueList } from "../../components/ui/Card";
import { Alert, PageLoader, Spinner, StatusBadge } from "../../components/ui/Feedback";
import { Checkbox, Field, Input, Segmented, Slider, Textarea } from "../../components/ui/Form";
import { Icon } from "../../components/ui/Icon";
import { Modal } from "../../components/ui/Modal";
import { useToast } from "../../components/ui/Toast";
import {
  days,
  formatDate,
  formatTenge,
  formatTengeRange,
  NBSP,
  parseWeight,
} from "../../lib/format";
import { useDebounced } from "../../lib/useDebounced";
import { formatDateTimeKz, formatDayKz, formatTimeKz, formatWait } from "../../lib/time";
import { PhotoViewer, type PhotoIssues } from "./PhotoViewer";
import {
  formatTengeInput,
  parseRateInput,
  parseTengeInput,
  queuedAt,
  rateInputValue,
  REVIEW_SLA_MIN,
  shortName,
  slaOf,
  tengeInputValue,
  useQueue,
} from "./expertLib";
import styles from "./Expert.module.css";

const CONDITION_LABEL: Record<string, string> = {
  NEW: "Новое",
  EXCELLENT: "Отличное",
  GOOD: "Хорошее",
  FAIR: "Потёртости",
  POOR: "Плохое",
};
const METAL_LABEL: Record<string, string> = {
  GOLD: "Золото",
  SILVER: "Серебро",
  PLATINUM: "Платина",
  PALLADIUM: "Палладий",
};

export function ReviewPage() {
  const id = Number(useParams().id);
  const query = useQuery({
    queryKey: ["application", id],
    queryFn: () => applicationsApi.get(id),
    enabled: Number.isFinite(id),
  });
  if (query.isPending) return <PageLoader />;
  if (query.isError)
    return (
      <div className={styles.page}>
        <BackLink />
        <Alert tone="danger" title="Не удалось открыть заявку">
          {query.error.message}
        </Alert>
      </div>
    );
  return <ReviewView app={query.data} />;
}

function BackLink({ inspection }: { inspection?: boolean }) {
  const fresh = useQueue(inspection ? "inspection" : "new");
  const n = fresh.data?.length;
  const label = inspection ? "Осмотр" : "Очередь";
  return (
    <Link to={inspection ? "/expert/inspections" : "/expert"} className={styles.back}>
      <Icon name="arrowLeft" size={18} />
      {n !== undefined ? `${label}, ${n} ${plural3(n)}` : label}
    </Link>
  );
}

function plural3(n: number) {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return "заявка";
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return "заявки";
  return "заявок";
}

/** Сохранить ответ backend в кэше и обновить очереди эксперта. */
function useApplicationUpdate() {
  const queryClient = useQueryClient();
  return (next: Application) => {
    queryClient.setQueryData(["application", next.id], next);
    void queryClient.invalidateQueries({ queryKey: ["expert"] });
  };
}

function ReviewView({ app }: { app: Application }) {
  const has = (a: string) => app.actions.includes(a as never);
  const inspection = app.status === "ITEM_DELIVERED" || app.status === "INSPECTED";
  const issues = useMemo<PhotoIssues>(() => {
    const out: PhotoIssues = {};
    app.pre_estimate?.details?.photos?.photos.forEach((p) => {
      if (p.issues.length) out[p.index] = p.issues;
    });
    return out;
  }, [app.pre_estimate]);

  return (
    <div className={styles.page}>
      <BackLink inspection={inspection} />
      <header className={styles.reviewHead}>
        <div className={styles.reviewTitle}>
          <div className={styles.titleRow}>
            <h1 className="t-h1">Заявка № {app.number}</h1>
            <StatusBadge status={app.status} />
          </div>
          <p className={styles.subline}>
            {app.title}, клиент {shortName(app.client.full_name)}
            {app.submitted_at &&
              `, отправлена ${formatDayKz(app.submitted_at)} в ${formatTimeKz(app.submitted_at)}`}
          </p>
        </div>
        {(app.status === "PRE_ESTIMATED" || app.status === "UNDER_REVIEW") && (
          <SlaChip since={queuedAt(app)} />
        )}
      </header>

      <div className={styles.reviewGrid}>
        <div className={styles.reviewMain}>
          <PhotoViewer photos={app.photos} categoryCode={app.category.code} issues={issues} />
          <div className={styles.infoCards}>
            <ClientFacts app={app} />
            <AutoEstimate app={app} />
          </div>
          <HistoryCard app={app} />
        </div>
        <aside className={styles.reviewSide}>
          {has("take") ? (
            <TakePanel app={app} />
          ) : has("send_offer") ? (
            <OfferForm app={app} />
          ) : has("inspect") ? (
            <InspectionForm app={app} />
          ) : (
            <StatusPanel app={app} />
          )}
        </aside>
      </div>
    </div>
  );
}

function SlaChip({ since }: { since: string }) {
  const sla = slaOf(since);
  return (
    <p className={styles.sla} data-late={sla.late || undefined}>
      <Icon name="clock" size={22} />
      <span>
        <strong>
          {sla.late
            ? `Ждёт ${formatWait(sla.waited)}`
            : `Ответить за ${formatWait(Math.max(1, sla.left))}`}
        </strong>
        <span>
          Норматив — {REVIEW_SLA_MIN}
          {NBSP}минут
        </span>
      </span>
    </p>
  );
}

// ---------- левая колонка ----------

function ClientFacts({ app }: { app: Application }) {
  return (
    <Card pad="l" className={styles.infoCard}>
      <h2 className="t-h4">Со слов клиента</h2>
      <KeyValueList>
        <KeyValue label="Изделие" value={app.title} />
        <KeyValue label="Категория" value={app.category.name} />
        {app.metal && <KeyValue label="Металл" value={METAL_LABEL[app.metal] ?? app.metal} />}
        {app.fineness && <KeyValue label="Проба" value={app.fineness} />}
        {app.weight_g && (
          <KeyValue label="Вес" value={`${String(app.weight_g).replace(".", ",")}${NBSP}г`} />
        )}
        {app.brand && <KeyValue label="Бренд" value={app.brand} />}
        {app.condition && (
          <KeyValue label="Состояние" value={CONDITION_LABEL[app.condition] ?? app.condition} />
        )}
        {app.requested_amount && (
          <KeyValue label="Хочет получить" value={formatTenge(app.requested_amount)} />
        )}
      </KeyValueList>
      {app.description && <p className={styles.quote}>{app.description}</p>}
    </Card>
  );
}

function AutoEstimate({ app }: { app: Application }) {
  const pre = app.pre_estimate;
  return (
    <Card pad="l" className={styles.infoCard}>
      <div>
        <h2 className="t-h4">Авто-оценка</h2>
        <p className={styles.caption}>По формуле и анализу фото</p>
      </div>
      {pre ? (
        <>
          <p className={styles.estimate}>{formatTengeRange(pre.value_min, pre.value_max)}</p>
          <div className={styles.confidence}>
            <span>Уверенность {pre.confidence}&nbsp;%</span>
            <span
              className={styles.meter}
              role="meter"
              aria-label="Уверенность авто-оценки"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={pre.confidence}
            >
              <span style={{ width: `${pre.confidence}%` }} />
            </span>
          </div>
          <ul className={styles.checks} role="list">
            {(pre.details?.photos?.issues ?? []).length === 0 ? (
              <li>
                <Icon name="check" size={18} className={styles.ok} />
                Снимки в норме, {app.photos.length}
                {NBSP}фото
              </li>
            ) : (
              pre.details!.photos!.issues.map((t) => (
                <li key={t}>
                  <Icon name="alert" size={18} className={styles.warn} />
                  {t}
                </li>
              ))
            )}
          </ul>
        </>
      ) : (
        <p className={styles.caption}>Авто-оценки нет: заявка ещё не отправлена.</p>
      )}
    </Card>
  );
}

function HistoryCard({ app }: { app: Application }) {
  const items = app.history.filter((h) => h.to_status !== "DRAFT");
  if (items.length === 0) return null;
  return (
    <Card pad="l" className={styles.infoCard}>
      <h2 className="t-h4">История заявки</h2>
      <ol className={styles.history} role="list">
        {[...items].reverse().map((h) => (
          <li key={h.id}>
            <time dateTime={h.created_at}>{formatDateTimeKz(h.created_at)}</time>
            <span>
              {h.to_status_label}
              {h.comment && <span className={styles.caption}>{h.comment}</span>}
            </span>
          </li>
        ))}
      </ol>
    </Card>
  );
}

// ---------- правая колонка ----------

function TakePanel({ app }: { app: Application }) {
  const update = useApplicationUpdate();
  const toast = useToast();
  const take = useMutation({
    mutationFn: () => expertApi.take(app.id),
    onSuccess: (next) => {
      update(next);
      toast.show({ title: "Заявка у вас в работе", tone: "success" });
    },
  });
  return (
    <Card pad="l" className={styles.sidePanel}>
      <h2 className="t-h3">Заявка ждёт эксперта</h2>
      <p className={styles.panelText}>
        Возьмите заявку, чтобы оценить её: другие эксперты перестанут её видеть в очереди, а клиент
        узнает, что оценка началась.
      </p>
      {take.isError && (
        <Alert tone="danger" title="Не удалось взять заявку">
          {take.error.message}
        </Alert>
      )}
      <Button size="l" block icon="check" loading={take.isPending} onClick={() => take.mutate()}>
        Взять в работу
      </Button>
    </Card>
  );
}

type Hallmark = "yes" | "no" | "unknown";
const HALLMARK: { value: Hallmark; label: string }[] = [
  { value: "yes", label: "Да" },
  { value: "no", label: "Нет" },
  { value: "unknown", label: "Не видно" },
];
const hallmarkValue = (h: Hallmark) => (h === "yes" ? true : h === "no" ? false : null);

function clampTerm(term: number, cat?: Category) {
  if (!cat) return term;
  return Math.min(cat.max_term_days, Math.max(cat.min_term_days, term));
}

/** Форма экспертной оценки с живым калькулятором (артборд 06, правая колонка). */
function OfferForm({ app }: { app: Application }) {
  const categories = useCategories();
  const cat = categories.data?.find((c) => c.id === app.category.id);
  const pre = app.pre_estimate;
  const [hallmark, setHallmark] = useState<Hallmark>("yes");
  const [value, setValue] = useState(pre ? tengeInputValue(pre.value) : "");
  const [ltv, setLtv] = useState(String(app.category.ltv_percent));
  // null — эксперт не трогал ставку: берём ставку категории, когда справочник загрузится
  const [rate, setRate] = useState<string | null>(null);
  const [term, setTerm] = useState(30);
  const [comment, setComment] = useState("");
  const [dialog, setDialog] = useState<"info" | "reject" | null>(null);
  const update = useApplicationUpdate();
  const toast = useToast();

  const rateText = rate ?? (cat ? rateInputValue(cat.daily_rate_bp) : "");
  const termDays = clampTerm(term, cat);

  const terms: OfferTerms | null = useMemo(() => {
    const mv = parseTengeInput(value);
    const l = Number(ltv);
    const bp = parseRateInput(rateText);
    if (!mv || !Number.isInteger(l) || l < 1 || l > 100 || !bp) return null;
    return {
      market_value: mv,
      ltv_percent: l,
      daily_rate_bp: bp,
      term_days: termDays,
      hallmark_confirmed: hallmarkValue(hallmark),
    };
  }, [value, ltv, rateText, termDays, hallmark]);

  const debounced = useDebounced(terms, 300);
  const quote = useQuery({
    queryKey: ["expert", "quote", app.id, debounced],
    queryFn: ({ signal }) => expertApi.quote(app.id, debounced!, signal),
    enabled: debounced !== null,
    placeholderData: (prev) => prev,
    retry: false,
  });

  const send = useMutation({
    mutationFn: () => expertApi.sendOffer(app.id, { ...terms!, comment: comment.trim() || null }),
    onSuccess: (next) => {
      update(next);
      toast.show({ title: "Предложение отправлено клиенту", tone: "success" });
    },
  });

  const err = send.error instanceof ApiError ? send.error : null;
  const fieldError = (f: string) => err?.fieldMessage(f);
  const valueError =
    value && !parseTengeInput(value) ? "Введите сумму в тенге" : fieldError("market_value");
  const ltvNum = Number(ltv);
  const ltvError =
    ltv && (!Number.isInteger(ltvNum) || ltvNum < 1 || ltvNum > 100)
      ? "От 1 до 100 %"
      : fieldError("ltv_percent");
  const rateError =
    rateText && !parseRateInput(rateText) ? "Например, 0,25" : fieldError("daily_rate_bp");

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!terms) return;
    send.mutate();
  };

  const q = quote.data;
  return (
    <Card pad="l" className={styles.sidePanel}>
      <form onSubmit={submit} noValidate className={styles.offerForm}>
        <h2 className="t-h3">Экспертная оценка</h2>
        <div className={styles.fieldGroup}>
          <span className={styles.label} aria-hidden="true">
            {app.category.requires_metal ? "Проба подтверждается по фото" : "Подлинность по фото"}
          </span>
          <Segmented
            label={
              app.category.requires_metal ? "Проба подтверждается по фото" : "Подлинность по фото"
            }
            options={HALLMARK}
            value={hallmark}
            onChange={setHallmark}
          />
        </div>
        <Field
          label="Рыночная стоимость"
          error={valueError}
          hint={pre ? `Авто-оценка: ${formatTengeRange(pre.value_min, pre.value_max)}` : undefined}
        >
          {(p) => (
            <Input
              {...p}
              inputMode="numeric"
              suffix="₸"
              value={value}
              onChange={(e) => setValue(formatTengeInput(e.target.value))}
              autoComplete="off"
            />
          )}
        </Field>
        <div className={styles.row2}>
          <Field
            label="Доля от оценки"
            error={ltvError}
            hint={`${app.category.name}: до ${app.category.ltv_percent}${NBSP}%`}
          >
            {(p) => (
              <Input
                {...p}
                inputMode="numeric"
                suffix="%"
                value={ltv}
                onChange={(e) => setLtv(e.target.value.replace(/\D/g, "").slice(0, 3))}
              />
            )}
          </Field>
          <Field label="Ставка" error={rateError}>
            {(p) => (
              <Input
                {...p}
                inputMode="decimal"
                suffix="% в день"
                value={rateText}
                onChange={(e) => setRate(e.target.value)}
              />
            )}
          </Field>
        </div>
        <Field label="Срок займа" aside={days(termDays)} error={fieldError("term_days")}>
          {(p) => (
            <Slider
              {...p}
              min={cat?.min_term_days ?? 7}
              max={cat?.max_term_days ?? 60}
              value={termDays}
              onChange={setTerm}
              minLabel={days(cat?.min_term_days ?? 7)}
              maxLabel={days(cat?.max_term_days ?? 60)}
            />
          )}
        </Field>

        <div className={styles.quoteBox} aria-live="polite" aria-busy={quote.isFetching}>
          <p className={styles.quoteCaption}>
            Клиент получит {quote.isFetching && <Spinner label="Пересчёт" />}
          </p>
          <p className={styles.quoteAmount}>{q && terms ? formatTenge(q.loan_amount) : "—"}</p>
          {quote.isError && !quote.isFetching ? (
            <p className={styles.quoteError}>{quote.error.message}</p>
          ) : (
            q &&
            terms && (
              <dl className={styles.quoteRows}>
                <div>
                  <dt>Проценты за {days(q.term_days)}</dt>
                  <dd>{formatTenge(q.interest)}</dd>
                </div>
                <div>
                  <dt>Вернуть до {formatDate(q.due_date)}</dt>
                  <dd>{formatTenge(q.total_to_repay)}</dd>
                </div>
              </dl>
            )
          )}
        </div>

        <Field label="Комментарий клиенту" hint="Клиент увидит его рядом с предложением">
          {(p) => (
            <Textarea
              {...p}
              rows={3}
              maxLength={2000}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Например: клеймо и вес совпадают с описанием"
            />
          )}
        </Field>
        {send.isError && (
          <Alert tone="danger" title="Предложение не отправлено">
            {send.error.message}
          </Alert>
        )}
        <Button type="submit" size="l" block loading={send.isPending} disabled={!terms}>
          Отправить предложение
        </Button>
        <div className={styles.secondaryActions}>
          <Button variant="secondary" icon="camera" onClick={() => setDialog("info")}>
            Запросить фото
          </Button>
          <Button variant="danger" onClick={() => setDialog("reject")}>
            Отклонить заявку
          </Button>
        </div>
      </form>
      <CommentDialog
        app={app}
        kind={dialog}
        onClose={() => setDialog(null)}
        onDone={(next, kind) => {
          update(next);
          setDialog(null);
          toast.show({
            title: kind === "info" ? "Запрос отправлен клиенту" : "Заявка отклонена",
            tone: kind === "info" ? "success" : "info",
          });
        }}
      />
    </Card>
  );
}

const DIALOG = {
  info: {
    title: "Запросить фото или сведения",
    label: "Что нужно клиенту",
    hint: "Например: сфотографируйте клеймо крупно при дневном свете",
    submit: "Отправить запрос",
    required: true,
  },
  reject: {
    title: "Отклонить заявку",
    label: "Причина для клиента",
    hint: "Клиент увидит её в карточке заявки",
    submit: "Отклонить заявку",
    required: false,
  },
} as const;

function CommentDialog({
  app,
  kind,
  onClose,
  onDone,
}: {
  app: Application;
  kind: "info" | "reject" | null;
  onClose: () => void;
  onDone: (next: Application, kind: "info" | "reject") => void;
}) {
  const [text, setText] = useState("");
  const [touched, setTouched] = useState(false);
  const meta = kind ? DIALOG[kind] : DIALOG.info;
  const run = useMutation({
    mutationFn: () =>
      kind === "reject"
        ? expertApi.reject(app.id, text.trim())
        : expertApi.needInfo(app.id, text.trim()),
    onSuccess: (next) => {
      setText("");
      setTouched(false);
      onDone(next, kind!);
    },
  });
  const missing = meta.required && text.trim() === "";
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (!missing) run.mutate();
  };
  return (
    <Modal
      open={kind !== null}
      onClose={onClose}
      title={meta.title}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Отмена
          </Button>
          <Button
            type="submit"
            form="expert-comment"
            variant={kind === "reject" ? "danger" : "primary"}
            loading={run.isPending}
          >
            {meta.submit}
          </Button>
        </>
      }
    >
      <form id="expert-comment" onSubmit={submit} noValidate className={styles.modalForm}>
        <Field
          label={meta.label}
          hint={meta.hint}
          error={touched && missing ? "Напишите, что нужно клиенту" : undefined}
        >
          {(p) => (
            <Textarea
              {...p}
              rows={4}
              maxLength={2000}
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
          )}
        </Field>
        {run.isError && (
          <Alert tone="danger" title="Не получилось">
            {run.error.message}
          </Alert>
        )}
      </form>
    </Modal>
  );
}

/** Осмотр доставленного изделия: подтвердить или уменьшить сумму займа. */
function InspectionForm({ app }: { app: Application }) {
  const offer = app.offer!;
  const [hallmark, setHallmark] = useState(true);
  const [weight, setWeight] = useState(app.weight_g ? String(app.weight_g).replace(".", ",") : "");
  const [value, setValue] = useState(
    tengeInputValue(app.expert_appraisal?.value ?? offer.market_value),
  );
  const [amount, setAmount] = useState(tengeInputValue(offer.loan_amount));
  const [comment, setComment] = useState("");
  const [touched, setTouched] = useState(false);
  const update = useApplicationUpdate();
  const toast = useToast();

  const input: InspectionInput | null = useMemo(() => {
    const mv = parseTengeInput(value);
    const la = parseTengeInput(amount);
    const w = weight.trim() ? parseWeight(weight) : null;
    if (!mv || !la || (weight.trim() && !w)) return null;
    return { market_value: mv, loan_amount: la, hallmark_confirmed: hallmark, weight_g: w };
  }, [value, amount, weight, hallmark]);

  const debounced = useDebounced(input, 300);
  const preview = useQuery({
    queryKey: ["expert", "inspection", app.id, debounced],
    queryFn: ({ signal }) => expertApi.inspectionQuote(app.id, debounced!, signal),
    enabled: debounced !== null,
    placeholderData: (prev) => prev,
    retry: false,
  });
  const adjusted = (parseTengeInput(amount) ?? offer.loan_amount) < offer.loan_amount;

  const run = useMutation({
    mutationFn: () => expertApi.inspect(app.id, { ...input!, comment: comment.trim() || null }),
    onSuccess: (next) => {
      update(next);
      toast.show({ title: "Осмотр подтверждён — клиент может получить деньги", tone: "success" });
    },
  });
  const err = run.error instanceof ApiError ? run.error : null;
  const commentMissing = adjusted && comment.trim() === "";

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (!input || commentMissing) return;
    run.mutate();
  };
  const p = preview.data;

  return (
    <Card pad="l" className={styles.sidePanel}>
      <form onSubmit={submit} noValidate className={styles.offerForm}>
        <div>
          <h2 className="t-h3">Осмотр в ломбарде</h2>
          <p className={styles.caption}>
            Клиент согласился на {formatTenge(offer.loan_amount)} на {days(offer.term_days)},{" "}
            {offer.rate_label}
          </p>
        </div>
        <Checkbox
          label={
            app.category.requires_metal ? "Проба и клеймо подтверждены" : "Подлинность подтверждена"
          }
          checked={hallmark}
          onChange={(e) => setHallmark(e.target.checked)}
        />
        {app.category.requires_metal && (
          <Field
            label="Вес по факту"
            hint={
              app.weight_g ? `Клиент указал ${String(app.weight_g).replace(".", ",")} г` : undefined
            }
            error={
              weight.trim() && !parseWeight(weight)
                ? "Например, 4,2"
                : err?.fieldMessage("weight_g")
            }
          >
            {(f) => (
              <Input
                {...f}
                inputMode="decimal"
                suffix="г"
                value={weight}
                onChange={(e) => setWeight(e.target.value)}
              />
            )}
          </Field>
        )}
        <Field
          label="Оценка при осмотре"
          error={
            value && !parseTengeInput(value) ? "Введите сумму" : err?.fieldMessage("market_value")
          }
        >
          {(f) => (
            <Input
              {...f}
              inputMode="numeric"
              suffix="₸"
              value={value}
              onChange={(e) => setValue(formatTengeInput(e.target.value))}
            />
          )}
        </Field>
        <Field
          label="Итоговая сумма займа"
          hint={`Не больше согласованной: ${formatTenge(offer.loan_amount)}`}
          error={
            amount && !parseTengeInput(amount)
              ? "Введите сумму"
              : (err?.fieldMessage("loan_amount") ??
                (preview.isError && !preview.isFetching ? preview.error.message : undefined))
          }
        >
          {(f) => (
            <Input
              {...f}
              inputMode="numeric"
              suffix="₸"
              value={amount}
              onChange={(e) => setAmount(formatTengeInput(e.target.value))}
            />
          )}
        </Field>
        {p && input && (
          <div className={styles.quoteBox} aria-live="polite">
            <p className={styles.quoteCaption}>Клиент получит</p>
            <p className={styles.quoteAmount}>{formatTenge(p.quote.loan_amount)}</p>
            <dl className={styles.quoteRows}>
              <div>
                <dt>Вернуть через {days(p.quote.term_days)}</dt>
                <dd>{formatTenge(p.quote.total_to_repay)}</dd>
              </div>
            </dl>
          </div>
        )}
        {adjusted && (
          <Alert tone="warning" title="Сумма меньше согласованной">
            Клиент увидит новую сумму перед выплатой — объясните причину.
          </Alert>
        )}
        <Field
          label={adjusted ? "Комментарий клиенту (обязательно)" : "Комментарий клиенту"}
          error={
            touched && commentMissing
              ? "Объясните клиенту, почему сумма изменилась"
              : err?.fieldMessage("comment")
          }
        >
          {(f) => (
            <Textarea
              {...f}
              rows={3}
              maxLength={2000}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
            />
          )}
        </Field>
        {run.isError && (
          <Alert tone="danger" title="Осмотр не сохранён">
            {run.error.message}
          </Alert>
        )}
        <Button type="submit" size="l" block icon="check" loading={run.isPending} disabled={!input}>
          Подтвердить осмотр
        </Button>
      </form>
    </Card>
  );
}

/** Заявка не требует действий эксперта — что с ней сейчас. */
function StatusPanel({ app }: { app: Application }) {
  const offer = app.offer;
  const blocks: Record<string, { title: string; text: ReactNode }> = {
    UNDER_REVIEW: {
      title: "Заявку ведёт другой эксперт",
      text: app.expert ? `${app.expert.full_name} оценивает изделие.` : "",
    },
    NEED_INFO: {
      title: "Ждём ответа клиента",
      text: "Клиент дополнит фото или сведения — заявка вернётся в очередь.",
    },
    OFFER_SENT: {
      title: "Предложение у клиента",
      text: offer?.expires_at ? `Действует до ${formatDateTimeKz(offer.expires_at)}.` : "",
    },
    REJECTED: { title: "Заявка отклонена", text: "" },
    OFFER_DECLINED: { title: "Клиент отказался от предложения", text: "" },
  };
  const b = blocks[app.status] ?? {
    title: app.status_label,
    text: "Оценка завершена, заявка идёт дальше: курьер, выплата, займ.",
  };
  return (
    <Card pad="l" className={styles.sidePanel}>
      <h2 className="t-h3">{b.title}</h2>
      {b.text && <p className={styles.panelText}>{b.text}</p>}
      {offer && (
        <KeyValueList>
          <KeyValue label="Оценка эксперта" value={formatTenge(offer.market_value)} />
          <KeyValue label="Сумма займа" value={formatTenge(offer.loan_amount)} emphasis />
          <KeyValue label="Срок" value={days(offer.term_days)} />
          <KeyValue label="Ставка" value={offer.rate_label} />
          <KeyValue label="Предложение" value={offer.status_label} />
        </KeyValueList>
      )}
      {app.inspection && (
        <KeyValueList>
          <KeyValue label="Оценка при осмотре" value={formatTenge(app.inspection.value)} />
          {app.inspection.details?.loan_amount !== undefined && (
            <KeyValue label="К выдаче" value={formatTenge(app.inspection.details.loan_amount)} />
          )}
        </KeyValueList>
      )}
    </Card>
  );
}
