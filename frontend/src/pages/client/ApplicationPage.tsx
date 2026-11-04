import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { applicationsApi } from "../../api/endpoints";
import type { Application, Offer, Photo } from "../../api/types";
import { SUPPORT_PHONE, SUPPORT_PHONE_HREF } from "../../layouts/PublicLayout";
import { ItemArt } from "../../components/ItemArt";
import { Hallmark } from "../../components/ui/Brand";
import { Button, ButtonLink } from "../../components/ui/Button";
import { Card, KeyValue, KeyValueList } from "../../components/ui/Card";
import { Alert, PageLoader, StatusBadge } from "../../components/ui/Feedback";
import { Field, Textarea } from "../../components/ui/Form";
import { Icon } from "../../components/ui/Icon";
import { Modal } from "../../components/ui/Modal";
import { useToast } from "../../components/ui/Toast";
import { days, formatDate, formatTenge, formatTengeRange, initials, NBSP } from "../../lib/format";
import { CardField } from "./CardField";
import { CourierForm } from "./CourierForm";
import {
  buildTimeline,
  cardDigits,
  currentHint,
  formatDateTimeKz,
  formatDayKz,
  formatTimeKz,
  isCardValid,
  itemKind,
} from "./clientLib";
import { TicketButton } from "./TicketButton";
import styles from "./Client.module.css";

export function ApplicationPage() {
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
  return <ApplicationView app={query.data} />;
}

function BackLink() {
  return (
    <Link to="/client" className={styles.back}>
      <Icon name="arrowLeft" size={18} />
      Мои заявки
    </Link>
  );
}

/** Обновить заявку в кэше после действия и сбросить зависимые списки. */
function useApplicationUpdate() {
  const queryClient = useQueryClient();
  return (next: Application) => {
    queryClient.setQueryData(["application", next.id], next);
    void queryClient.invalidateQueries({ queryKey: ["applications"] });
    void queryClient.invalidateQueries({ queryKey: ["loans"] });
    void queryClient.invalidateQueries({ queryKey: ["notifications", "unread"] });
  };
}

function subtitle(app: Application): string {
  const parts = [`Заявка № ${app.number} от ${formatDayKz(app.created_at)}`];
  if (app.fineness) parts.push(`${app.category.name.toLowerCase()} ${app.fineness}`);
  else parts.push(app.category.name.toLowerCase());
  if (app.weight_g) parts.push(`${String(app.weight_g).replace(".", ",")}${NBSP}г`);
  if (app.brand) parts.push(app.brand);
  return parts.join(", ");
}

function ApplicationView({ app }: { app: Application }) {
  const has = (a: string) => app.actions.includes(a as never);
  return (
    <div className={styles.page}>
      <BackLink />
      <header className={styles.appHead}>
        <div className={styles.titleRow}>
          <h1 className="t-h1">{app.title}</h1>
          <StatusBadge status={app.status} />
        </div>
        <p className={styles.subline}>{subtitle(app)}</p>
      </header>

      <div className={styles.split}>
        <div className={styles.mainCol}>
          <MainPanels app={app} has={has} />
        </div>
        <aside className={styles.side}>
          {app.pre_estimate && <PreEstimateCard app={app} />}
          {!app.pre_estimate && app.photos.length > 0 && <PhotosCard photos={app.photos} />}
          <TimelineCard app={app} />
          <Card pad="l" className={styles.sideCard}>
            <h2 className="t-h4">Есть вопрос по заявке?</h2>
            <p className={styles.sideNote}>
              Позвоните нам и назовите номер {app.number} — ежедневно с 9 до 21.
            </p>
            <a href={SUPPORT_PHONE_HREF} className={styles.strongLink}>
              {SUPPORT_PHONE}
            </a>
          </Card>
        </aside>
      </div>
    </div>
  );
}

function MainPanels({ app, has }: { app: Application; has: (a: string) => boolean }) {
  const s = app.status;
  const [rescheduling, setRescheduling] = useState(false);
  const update = useApplicationUpdate();
  const toast = useToast();
  const courierRef = useRef<HTMLDivElement>(null);

  if (s === "DRAFT" || s === "NEED_INFO") return <DraftPanel app={app} canDelete={has("delete")} />;

  if (s === "SUBMITTED" || s === "PRE_ESTIMATED" || s === "UNDER_REVIEW") {
    return (
      <Card as="section" pad="l" className={styles.panel}>
        <PanelHead
          title={s === "UNDER_REVIEW" ? "Эксперт оценивает изделие" : "Заявка ждёт эксперта"}
        />
        <p className={styles.panelText}>
          {s === "UNDER_REVIEW" && app.expert
            ? `${app.expert.full_name} изучает фото и параметры. `
            : "Первый свободный эксперт возьмёт заявку в работу. "}
          Предложение придёт в течение часа в рабочее время — мы пришлём уведомление.
        </p>
        <WaitNote />
      </Card>
    );
  }

  const offerCard = app.offer && ["OFFER_SENT", "OFFER_ACCEPTED", "OFFER_DECLINED"].includes(s) && (
    <OfferPanel
      app={app}
      offer={app.offer}
      canDecide={has("accept_offer")}
      onAccepted={(next) => {
        update(next);
        toast.show({ title: "Предложение принято", text: "Выберите время визита курьера" });
        requestAnimationFrame(() =>
          courierRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }),
        );
      }}
    />
  );

  if (s === "OFFER_SENT" || s === "OFFER_DECLINED")
    return (
      <>
        {offerCard}
        {s === "OFFER_DECLINED" && <FinalPanel app={app} />}
      </>
    );

  if (s === "OFFER_ACCEPTED") {
    return (
      <>
        {offerCard}
        <div ref={courierRef} className={styles.anchor}>
          <Card as="section" pad="l" className={styles.panel}>
            <PanelHead title="Вызов курьера" aside="Бесплатно" />
            <CourierForm
              app={app}
              mode="pickup"
              onDone={(next) => {
                update(next);
                toast.show({ title: "Курьер вызван", text: next.courier_visit?.slot_label });
              }}
            />
          </Card>
        </div>
      </>
    );
  }

  if (
    ["COURIER_SCHEDULED", "COURIER_EN_ROUTE", "ITEM_PICKED_UP"].includes(s) &&
    app.courier_visit
  ) {
    return (
      <Card as="section" pad="l" className={styles.panel}>
        <PanelHead title="Курьер заберёт изделие" />
        {rescheduling ? (
          <CourierForm
            app={app}
            mode="reschedule"
            onCancel={() => setRescheduling(false)}
            onDone={(next) => {
              update(next);
              setRescheduling(false);
              toast.show({ title: "Визит перенесён", text: next.courier_visit?.slot_label });
            }}
          />
        ) : (
          <VisitInfo
            app={app}
            action={
              has("reschedule_courier") && (
                <Button variant="secondary" onClick={() => setRescheduling(true)}>
                  Перенести визит
                </Button>
              )
            }
          />
        )}
      </Card>
    );
  }

  if (s === "ITEM_DELIVERED") {
    return (
      <Card as="section" pad="l" className={styles.panel}>
        <PanelHead title="Изделие в ломбарде" />
        <p className={styles.panelText}>
          Эксперт проверит пробу, вес и подлинность при осмотре. Сразу после этого вы сможете
          получить деньги на карту.
        </p>
        <WaitNote />
      </Card>
    );
  }

  if (s === "INSPECTED") return <PayoutPanel app={app} canPay={has("issue_funds")} />;

  if (app.loan && ["FUNDS_ISSUED", "LOAN_ACTIVE", "EXTENDED", "OVERDUE"].includes(s))
    return <LoanPanel app={app} />;

  if (s === "REPAID") {
    return (
      <>
        {app.loan && <LoanPanel app={app} />}
        <Card as="section" pad="l" className={styles.panel}>
          {has("schedule_return") ? (
            <>
              <PanelHead title="Вернуть изделие" aside="Бесплатно" />
              <CourierForm
                app={app}
                mode="return"
                onDone={(next) => {
                  update(next);
                  toast.show({
                    title: "Курьер вызван",
                    text: "Он привезёт изделие в выбранное время",
                  });
                }}
              />
            </>
          ) : app.courier_visit?.kind === "RETURN" ? (
            <>
              <PanelHead title="Курьер привезёт изделие" />
              <VisitInfo app={app} />
            </>
          ) : (
            <PanelHead title="Займ погашен" />
          )}
        </Card>
      </>
    );
  }

  return (
    <>
      {app.loan && <LoanPanel app={app} />}
      <FinalPanel app={app} />
    </>
  );
}

function PanelHead({ title, aside }: { title: string; aside?: ReactNode }) {
  return (
    <div className={styles.panelHead}>
      <h2 className="t-h3">{title}</h2>
      {aside && <span className={styles.panelAside}>{aside}</span>}
    </div>
  );
}

function WaitNote() {
  return (
    <p className={styles.waitNote}>
      <Icon name="bell" size={18} />
      Статус обновится здесь и в уведомлениях — страницу можно закрыть.
    </p>
  );
}

// ---------- черновик ----------

function DraftPanel({ app, canDelete }: { app: Application; canDelete: boolean }) {
  const navigate = useNavigate();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [confirm, setConfirm] = useState(false);
  const remove = useMutation({
    mutationFn: () => applicationsApi.remove(app.id),
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: ["application", app.id] });
      void queryClient.invalidateQueries({ queryKey: ["applications"] });
      toast.show({ title: "Черновик удалён" });
      navigate("/client");
    },
  });
  const request = [...app.history].reverse().find((h) => h.to_status === "NEED_INFO");
  return (
    <Card as="section" pad="l" className={styles.panel}>
      {app.status === "NEED_INFO" ? (
        <>
          <PanelHead title="Эксперт просит дополнить заявку" />
          {request?.comment && <ExpertNote name={app.expert?.full_name} text={request.comment} />}
          <p className={styles.panelText}>
            Добавьте фото или уточните параметры и отправьте заявку снова — она вернётся к тому же
            эксперту.
          </p>
        </>
      ) : (
        <>
          <PanelHead title="Заявка ещё не отправлена" />
          <p className={styles.panelText}>
            Добавьте параметры и фото изделия, затем отправьте заявку — предварительная оценка
            появится сразу.
          </p>
        </>
      )}
      <div className={styles.actions}>
        <ButtonLink to={`/client/new?draft=${app.id}`} icon="camera">
          {app.status === "NEED_INFO" ? "Дополнить заявку" : "Продолжить заполнение"}
        </ButtonLink>
        {canDelete && (
          <Button variant="ghost" onClick={() => setConfirm(true)}>
            Удалить черновик
          </Button>
        )}
      </div>
      <Modal
        open={confirm}
        onClose={() => setConfirm(false)}
        title="Удалить черновик?"
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirm(false)}>
              Оставить
            </Button>
            <Button variant="danger" loading={remove.isPending} onClick={() => remove.mutate()}>
              Удалить
            </Button>
          </>
        }
      >
        <p>Черновик «{app.title}» и его фото будут удалены без возможности восстановления.</p>
        {remove.isError && <Alert tone="danger" title={remove.error.message} />}
      </Modal>
    </Card>
  );
}

function ExpertNote({ name, text }: { name?: string | null; text: string }) {
  return (
    <div className={styles.expertNote}>
      <span className={styles.avatar} aria-hidden="true">
        {name ? initials(name) : "Э"}
      </span>
      <div>
        <p className={styles.expertName}>{name ? `${name}, эксперт-оценщик` : "Эксперт-оценщик"}</p>
        <p className={styles.expertText}>{text}</p>
      </div>
    </div>
  );
}

// ---------- предложение эксперта ----------

function OfferPanel({
  app,
  offer,
  canDecide,
  onAccepted,
}: {
  app: Application;
  offer: Offer;
  canDecide: boolean;
  onAccepted: (app: Application) => void;
}) {
  const update = useApplicationUpdate();
  const toast = useToast();
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState("");
  const accept = useMutation({
    mutationFn: () => applicationsApi.acceptOffer(app.id),
    onSuccess: onAccepted,
    onError: (err) => {
      toast.show({ title: err.message, tone: "danger" });
      void applicationsApi
        .get(app.id)
        .then(update)
        .catch(() => undefined);
    },
  });
  const decline = useMutation({
    mutationFn: () => applicationsApi.declineOffer(app.id, reason.trim()),
    onSuccess: (next) => {
      update(next);
      setDeclining(false);
      toast.show({ title: "Вы отказались от предложения", tone: "info" });
    },
  });

  const accepted = offer.status === "ACCEPTED";
  const showHallmark = app.fineness && offer.hallmark_confirmed !== false;
  const due = offer.quote.due_date;

  return (
    <Card as="section" pad="l" className={styles.panel} aria-labelledby="offer-title">
      <div className={styles.panelHead}>
        <h2 id="offer-title" className="t-h3">
          Предложение эксперта
        </h2>
        <span className={styles.panelAside}>
          {accepted
            ? "Вы приняли"
            : offer.status === "SENT" && offer.expires_at
              ? `Действует до ${formatDateTimeKz(offer.expires_at)}`
              : offer.status_label}
        </span>
      </div>

      <div className={styles.offerAmounts}>
        <div>
          <p className={styles.amountCaption}>Сумма займа</p>
          <p className={styles.amountXl}>
            {formatTenge(offer.loan_amount)}
            {showHallmark && (
              <Hallmark label={`Проба ${app.fineness}`}>{String(app.fineness)}</Hallmark>
            )}
          </p>
        </div>
        <div>
          <p className={styles.amountCaption}>Вернуть до {formatDate(due)}</p>
          <p className={styles.amountL}>{formatTenge(offer.total_to_repay)}</p>
        </div>
      </div>

      <dl className={styles.facts}>
        <div>
          <dt>Оценка эксперта</dt>
          <dd>{formatTenge(offer.market_value)}</dd>
        </div>
        <div>
          <dt>Ставка</dt>
          <dd>{offer.rate_label}</dd>
        </div>
        <div>
          <dt>Срок</dt>
          <dd>{days(offer.term_days)}</dd>
        </div>
      </dl>

      {offer.comment && <ExpertNote name={offer.expert.full_name} text={offer.comment} />}

      <p className={styles.fineprint}>
        Проценты — {formatTenge(offer.interest)} за {days(offer.term_days)}. Даты займа
        отсчитываются со дня выдачи денег; вернуть можно раньше — проценты только за фактические
        дни.
      </p>

      {canDecide && (
        <div className={styles.actions}>
          <Button icon="truck" size="l" loading={accept.isPending} onClick={() => accept.mutate()}>
            Принять и вызвать курьера
          </Button>
          <Button variant="ghost" onClick={() => setDeclining(true)}>
            Отказаться
          </Button>
        </div>
      )}

      <Modal
        open={declining}
        onClose={() => setDeclining(false)}
        title="Отказаться от предложения?"
        footer={
          <>
            <Button variant="secondary" onClick={() => setDeclining(false)}>
              Вернуться
            </Button>
            <Button variant="danger" loading={decline.isPending} onClick={() => decline.mutate()}>
              Отказаться
            </Button>
          </>
        }
      >
        <p>Заявка будет закрыта. Чтобы получить новое предложение, создайте заявку заново.</p>
        <Field label="Причина (необязательно)">
          {(p) => (
            <Textarea
              {...p}
              value={reason}
              maxLength={2000}
              placeholder="Например, сумма меньше, чем нужно"
              onChange={(e) => setReason(e.target.value)}
            />
          )}
        </Field>
        {decline.isError && <Alert tone="danger" title={decline.error.message} />}
      </Modal>
    </Card>
  );
}

// ---------- курьер ----------

function VisitInfo({ app, action }: { app: Application; action?: ReactNode }) {
  const v = app.courier_visit!;
  return (
    <div className={styles.visit}>
      <div className={styles.visitWhen}>
        <Icon name="calendar" size={22} />
        <div>
          <p className={styles.visitSlot}>
            {formatDayKz(v.slot_start)}, {formatTimeKz(v.slot_start)}–{formatTimeKz(v.slot_end)}
          </p>
          <p className={styles.muted}>{v.status_label}</p>
        </div>
      </div>
      <KeyValueList>
        <KeyValue label="Адрес" value={`${v.city}, ${v.address}`} />
        <KeyValue label="Телефон" value={v.contact_phone_display} />
        {v.comment && <KeyValue label="Комментарий" value={v.comment} />}
        <KeyValue
          label="Курьер"
          value={v.courier ? v.courier.full_name : "Назначим за день до визита"}
        />
      </KeyValueList>
      {action && <div className={styles.actions}>{action}</div>}
    </div>
  );
}

// ---------- осмотр и выплата ----------

function PayoutPanel({ app, canPay }: { app: Application; canPay: boolean }) {
  const update = useApplicationUpdate();
  const toast = useToast();
  const [card, setCard] = useState("");
  const [error, setError] = useState<string>();
  const amount = app.inspection?.details?.loan_amount ?? app.offer?.loan_amount ?? 0;
  const adjusted = app.offer && amount !== app.offer.loan_amount;
  const pay = useMutation({
    mutationFn: () => applicationsApi.payout(app.id, cardDigits(card)),
    onSuccess: (next) => {
      update(next);
      toast.show({
        title: "Деньги отправлены на карту",
        text: next.loan ? `Залоговый билет № ${next.loan.ticket_number}` : undefined,
      });
    },
    onError: (err) => setError(err.message),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!isCardValid(card)) {
      setError("Проверьте номер карты — в нём ошибка");
      return;
    }
    setError(undefined);
    pay.mutate();
  };
  return (
    <Card as="section" pad="l" className={styles.panel}>
      <PanelHead
        title="Осмотр пройден"
        aside={app.inspection ? formatDateTimeKz(app.inspection.created_at) : undefined}
      />
      {app.inspection?.comment && (
        <ExpertNote name={app.expert?.full_name} text={app.inspection.comment} />
      )}
      <div className={styles.offerAmounts}>
        <div>
          <p className={styles.amountCaption}>К выдаче</p>
          <p className={styles.amountXl}>{formatTenge(amount)}</p>
        </div>
        {app.inspection && (
          <div>
            <p className={styles.amountCaption}>Оценка при осмотре</p>
            <p className={styles.amountL}>{formatTenge(app.inspection.value)}</p>
          </div>
        )}
      </div>
      {adjusted && (
        <Alert tone="warning" title="Сумма изменилась после осмотра">
          В предложении было {formatTenge(app.offer!.loan_amount)}. Если новая сумма вам не
          подходит, позвоните нам — вернём изделие бесплатно.
        </Alert>
      )}
      {canPay && (
        <form onSubmit={submit} noValidate className={styles.payForm}>
          <CardField
            value={card}
            onChange={(v) => {
              setCard(v);
              setError(undefined);
            }}
            error={error}
            label="Карта для зачисления"
          />
          <Button type="submit" size="l" icon="card" loading={pay.isPending}>
            Получить {formatTenge(amount)}
          </Button>
        </form>
      )}
    </Card>
  );
}

// ---------- займ ----------

function LoanPanel({ app }: { app: Application }) {
  const loan = app.loan!;
  const open = loan.status === "ACTIVE" || loan.status === "OVERDUE";
  return (
    <Card as="section" pad="l" className={styles.panel}>
      <PanelHead title={`Залоговый билет № ${loan.ticket_number}`} aside={loan.status_label} />
      {loan.status === "OVERDUE" && (
        <Alert tone="danger" title={`Просрочка ${days(loan.overdue_days)}`}>
          Погасите займ до {formatDate(loan.grace_until)} — после этого изделие перейдёт ломбарду.
        </Alert>
      )}
      <div className={styles.offerAmounts}>
        <div>
          <p className={styles.amountCaption}>{open ? "Погасить сегодня" : "Выдано"}</p>
          <p className={styles.amountXl}>
            {formatTenge(open ? loan.total_to_repay : loan.principal)}
          </p>
        </div>
        <div>
          <p className={styles.amountCaption}>{open ? "Срок возврата" : "Закрыт"}</p>
          <p className={styles.amountL}>
            {open ? formatDate(loan.due_date) : loan.closed_at ? formatDayKz(loan.closed_at) : "—"}
          </p>
        </div>
      </div>
      <dl className={styles.facts}>
        <div>
          <dt>Сумма займа</dt>
          <dd>{formatTenge(loan.principal)}</dd>
        </div>
        <div>
          <dt>Проценты на сегодня</dt>
          <dd>{formatTenge(loan.accrued_interest)}</dd>
        </div>
        <div>
          <dt>Ставка</dt>
          <dd>{loan.rate_label}</dd>
        </div>
      </dl>
      <div className={styles.actions}>
        {open && (
          <ButtonLink to={`/client/loans/${loan.id}`} icon="card">
            Погасить или продлить
          </ButtonLink>
        )}
        <TicketButton ticketUrl={loan.ticket_url} ticketNumber={loan.ticket_number} />
      </div>
    </Card>
  );
}

// ---------- итог ----------

function FinalPanel({ app }: { app: Application }) {
  const last = app.history[app.history.length - 1];
  const text: Record<string, { title: string; body: string }> = {
    REJECTED: {
      title: "Эксперт отклонил заявку",
      body: "К сожалению, мы не можем принять это изделие в залог.",
    },
    OFFER_DECLINED: {
      title: "Вы отказались от предложения",
      body: "Заявка закрыта. Если передумаете — создайте новую, это займёт пару минут.",
    },
    ITEM_RETURNED: {
      title: "Изделие возвращено",
      body: "Займ закрыт, изделие у вас. Спасибо, что выбрали нас!",
    },
    FORFEITED: {
      title: "Изделие перешло ломбарду",
      body: "Займ не был погашен в льготный период. По вопросам звоните в поддержку.",
    },
  };
  const t = text[app.status] ?? { title: app.status_label, body: "" };
  return (
    <Card as="section" pad="l" className={styles.panel}>
      <PanelHead title={t.title} />
      {app.status === "REJECTED" && last?.comment && (
        <ExpertNote name={app.expert?.full_name} text={last.comment} />
      )}
      {t.body && <p className={styles.panelText}>{t.body}</p>}
      <div className={styles.actions}>
        <ButtonLink to="/client/new" variant="secondary" icon="camera">
          Новая заявка
        </ButtonLink>
      </div>
    </Card>
  );
}

// ---------- боковая колонка ----------

function PreEstimateCard({ app }: { app: Application }) {
  const pre = app.pre_estimate!;
  const issues = pre.details?.photos?.issues ?? [];
  return (
    <Card pad="l" className={styles.sideCard}>
      <h2 className="t-h4">Предварительная оценка</h2>
      <p className={styles.sideNote}>По фото и параметрам, {formatDayKz(pre.created_at)}</p>
      <p className={styles.estimate}>{formatTengeRange(pre.value_min, pre.value_max)}</p>
      <div className={styles.confidence}>
        <span>Уверенность</span>
        <span>
          {pre.confidence}
          {NBSP}%
        </span>
        <span
          className={styles.meter}
          role="meter"
          aria-label="Уверенность оценки"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pre.confidence}
        >
          <span style={{ width: `${pre.confidence}%` }} />
        </span>
      </div>
      {issues.length > 0 && (
        <details className={styles.issues}>
          <summary>Замечания к фото: {issues.length}</summary>
          <ul>
            {issues.map((i) => (
              <li key={i}>{i}</li>
            ))}
          </ul>
        </details>
      )}
      <PhotoStrip photos={app.photos} categoryCode={app.category.code} />
    </Card>
  );
}

function PhotosCard({ photos }: { photos: Photo[] }) {
  return (
    <Card pad="l" className={styles.sideCard}>
      <h2 className="t-h4">Фото изделия</h2>
      <PhotoStrip photos={photos} categoryCode="" />
    </Card>
  );
}

function PhotoStrip({ photos, categoryCode }: { photos: Photo[]; categoryCode: string }) {
  const [open, setOpen] = useState<number | null>(null);
  if (!photos.length)
    return categoryCode ? (
      <ItemArt kind={itemKind(categoryCode)} className={styles.stripArt} />
    ) : null;
  const current = open !== null ? photos[open] : null;
  return (
    <>
      <ul className={styles.strip} role="list">
        {photos.map((p, i) => (
          <li key={p.id}>
            <button type="button" onClick={() => setOpen(i)} aria-label={`Открыть фото ${i + 1}`}>
              <img src={p.thumb_url} alt="" />
            </button>
          </li>
        ))}
      </ul>
      <Modal
        open={current !== null}
        onClose={() => setOpen(null)}
        title={`Фото ${(open ?? 0) + 1} из ${photos.length}`}
        footer={
          photos.length > 1 && (
            <>
              <Button
                variant="secondary"
                icon="chevronLeft"
                onClick={() => setOpen(((open ?? 0) - 1 + photos.length) % photos.length)}
              >
                Предыдущее
              </Button>
              <Button
                variant="secondary"
                onClick={() => setOpen(((open ?? 0) + 1) % photos.length)}
              >
                Следующее
              </Button>
            </>
          )
        }
      >
        {current && (
          <img src={current.url} alt={`Фото ${(open ?? 0) + 1}`} className={styles.fullPhoto} />
        )}
      </Modal>
    </>
  );
}

function TimelineCard({ app }: { app: Application }) {
  const items = buildTimeline(app);
  const hint = currentHint(app);
  return (
    <Card pad="l" className={styles.sideCard}>
      <h2 className="t-h4">Ход заявки</h2>
      <ol className={styles.timeline}>
        {items.map((it, i) => {
          const prev = items[i - 1]?.at;
          const sameDay = !!(it.at && prev && formatDayKz(prev) === formatDayKz(it.at));
          return (
            <li
              key={it.key}
              data-state={it.state}
              aria-current={it.state === "current" ? "step" : undefined}
            >
              <span className={styles.tlMarker} aria-hidden="true">
                {it.state === "done" && <Icon name="check" size={12} strokeWidth={3} />}
              </span>
              <span className={styles.tlBody}>
                <span className={styles.tlLabel}>
                  {it.label}
                  {it.state === "todo" && <span className="visually-hidden"> — впереди</span>}
                </span>
                {it.state === "current" && hint && <span className={styles.tlHint}>{hint}</span>}
                {it.comment && <span className={styles.tlHint}>{it.comment}</span>}
              </span>
              {it.at && (
                <time className={styles.tlTime} dateTime={it.at}>
                  {sameDay ? formatTimeKz(it.at) : formatDateTimeKz(it.at)}
                </time>
              )}
            </li>
          );
        })}
      </ol>
    </Card>
  );
}
