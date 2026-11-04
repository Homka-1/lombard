import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { loansApi } from "../../api/endpoints";
import type { Loan } from "../../api/types";
import { ButtonLink, Button } from "../../components/ui/Button";
import { Card, KeyValue, KeyValueList } from "../../components/ui/Card";
import { Alert, Badge, PageLoader, Spinner } from "../../components/ui/Feedback";
import { Segmented } from "../../components/ui/Form";
import { Icon } from "../../components/ui/Icon";
import { Modal } from "../../components/ui/Modal";
import { useToast } from "../../components/ui/Toast";
import type { Tone } from "../../design/status.gen";
import { days, formatDate, formatTenge, plural } from "../../lib/format";
import { CardField } from "./CardField";
import { cardDigits, formatDateTimeKz, formatDayKz, isCardValid } from "./clientLib";
import { TicketButton } from "./TicketButton";
import styles from "./Client.module.css";

const LOAN_TONE: Record<Loan["status"], Tone> = {
  ACTIVE: "success",
  OVERDUE: "danger",
  REPAID: "neutral",
  FORFEITED: "danger",
};

const isOpen = (l: Pick<Loan, "status">) => l.status === "ACTIVE" || l.status === "OVERDUE";

function dueText(l: Loan): string {
  if (l.status === "OVERDUE")
    return `Просрочка ${days(l.overdue_days)}, льготный период до ${formatDate(l.grace_until)}`;
  if (l.days_left === 0) return "Вернуть сегодня";
  return `Вернуть до ${formatDate(l.due_date)}, ${l.days_left} ${plural(l.days_left, ["день", "дня", "дней"])} осталось`;
}

export function LoansPage() {
  const loans = useQuery({ queryKey: ["loans"], queryFn: loansApi.list });
  if (loans.isPending) return <PageLoader />;
  const open = loans.data?.filter(isOpen) ?? [];
  const closed = loans.data?.filter((l) => !isOpen(l)) ?? [];
  return (
    <div className={styles.page}>
      <header className={styles.pageHead}>
        <h1 className="t-h1">Займы</h1>
      </header>
      {loans.isError ? (
        <Alert tone="danger" title="Не удалось загрузить займы">
          {loans.error.message}
        </Alert>
      ) : loans.data.length === 0 ? (
        <Card pad="l" className={styles.empty}>
          <Icon name="card" size={32} className={styles.emptyIcon} />
          <h2 className="t-h3">Займов пока нет</h2>
          <p className={styles.emptyText}>
            Займ появится здесь, когда эксперт осмотрит изделие и деньги поступят на вашу карту.
          </p>
          <ButtonLink to="/client" variant="secondary">
            Мои заявки
          </ButtonLink>
        </Card>
      ) : (
        <>
          {open.length > 0 && (
            <section className={styles.loanGroup} aria-labelledby="loans-open">
              <h2 id="loans-open" className="t-h3">
                Действующие
              </h2>
              <ul className={styles.loanList} role="list">
                {open.map((l) => (
                  <LoanRow key={l.id} loan={l} />
                ))}
              </ul>
            </section>
          )}
          {closed.length > 0 && (
            <section className={styles.loanGroup} aria-labelledby="loans-closed">
              <h2 id="loans-closed" className="t-h3">
                Закрытые
              </h2>
              <ul className={styles.loanList} role="list">
                {closed.map((l) => (
                  <LoanRow key={l.id} loan={l} />
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}

function LoanRow({ loan }: { loan: Loan }) {
  const open = isOpen(loan);
  return (
    <li>
      <Link
        to={`/client/loans/${loan.id}`}
        className={styles.loanRow}
        data-overdue={loan.status === "OVERDUE" || undefined}
      >
        <span className={styles.loanMain}>
          <span className={styles.appTitle}>{loan.application.title}</span>
          <span className={styles.appMeta}>Билет № {loan.ticket_number}</span>
        </span>
        <span className={styles.loanDue}>
          <Badge tone={LOAN_TONE[loan.status]}>{loan.status_label}</Badge>
          {open && <span className={styles.appMeta}>{dueText(loan)}</span>}
        </span>
        <span className={styles.appAmount}>
          <span className={styles.amountLabel}>{open ? "Погасить сегодня" : "Сумма займа"}</span>
          {formatTenge(open ? loan.total_to_repay : loan.principal)}
        </span>
        <Icon name="chevronRight" size={20} className={styles.appChevron} />
      </Link>
    </li>
  );
}

// ---------- карточка займа ----------

export function LoanPage() {
  const id = Number(useParams().id);
  const loan = useQuery({ queryKey: ["loan", id], queryFn: () => loansApi.get(id) });
  if (loan.isPending) return <PageLoader />;
  if (loan.isError)
    return (
      <div className={styles.page}>
        <LoansBack />
        <Alert tone="danger" title="Не удалось открыть займ">
          {loan.error.message}
        </Alert>
      </div>
    );
  return <LoanView loan={loan.data} />;
}

function LoansBack() {
  return (
    <Link to="/client/loans" className={styles.back}>
      <Icon name="arrowLeft" size={18} />
      Займы
    </Link>
  );
}

function useLoanUpdate() {
  const queryClient = useQueryClient();
  return (next: Loan) => {
    queryClient.setQueryData(["loan", next.id], next);
    void queryClient.invalidateQueries({ queryKey: ["loans"] });
    void queryClient.invalidateQueries({ queryKey: ["application", next.application.id] });
    void queryClient.invalidateQueries({ queryKey: ["applications"] });
    void queryClient.invalidateQueries({ queryKey: ["notifications", "unread"] });
  };
}

function LoanView({ loan }: { loan: Loan }) {
  const [modal, setModal] = useState<"repay" | "extend" | null>(null);
  const open = isOpen(loan);
  const progress = Math.min(100, Math.round((loan.days_used / Math.max(1, loan.term_days)) * 100));
  return (
    <div className={styles.page}>
      <LoansBack />
      <header className={styles.appHead}>
        <div className={styles.titleRow}>
          <h1 className="t-h1">Билет № {loan.ticket_number}</h1>
          <Badge tone={LOAN_TONE[loan.status]}>{loan.status_label}</Badge>
        </div>
        <p className={styles.subline}>
          <Link to={`/client/applications/${loan.application.id}`}>{loan.application.title}</Link>,
          выдан {formatDayKz(loan.issued_at)}
        </p>
      </header>

      <div className={styles.split}>
        <div className={styles.mainCol}>
          <Card as="section" pad="l" className={styles.panel}>
            {loan.status === "OVERDUE" && (
              <Alert tone="danger" title={`Просрочка ${days(loan.overdue_days)}`}>
                Погасите займ или продлите его до {formatDate(loan.grace_until)} — после этого
                изделие перейдёт ломбарду.
              </Alert>
            )}
            {open && loan.due_soon && loan.status === "ACTIVE" && (
              <Alert tone="warning" title="Срок возврата скоро">
                {dueText(loan)}. Продлите займ, если нужно больше времени.
              </Alert>
            )}
            <div className={styles.offerAmounts}>
              <div>
                <p className={styles.amountCaption}>{open ? "Погасить сегодня" : "Сумма займа"}</p>
                <p className={styles.amountXl}>
                  {formatTenge(open ? loan.total_to_repay : loan.principal)}
                </p>
              </div>
              {open && (
                <div>
                  <p className={styles.amountCaption}>В срок, {formatDate(loan.due_date)}</p>
                  <p className={styles.amountL}>{formatTenge(loan.total_at_due)}</p>
                </div>
              )}
            </div>
            {open && (
              <div className={styles.term}>
                <div className={styles.confidence}>
                  <span>
                    {loan.status === "OVERDUE"
                      ? "Срок прошёл"
                      : `День ${loan.days_used} из ${loan.term_days}`}
                  </span>
                  <span>{loan.status === "OVERDUE" ? "" : dueText(loan)}</span>
                  <span
                    className={styles.meter}
                    data-tone={loan.status === "OVERDUE" ? "danger" : undefined}
                    aria-hidden="true"
                  >
                    <span style={{ width: `${loan.status === "OVERDUE" ? 100 : progress}%` }} />
                  </span>
                </div>
              </div>
            )}
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
              {loan.actions.includes("repay") && (
                <Button size="l" icon="card" onClick={() => setModal("repay")}>
                  Погасить {formatTenge(loan.total_to_repay)}
                </Button>
              )}
              {loan.actions.includes("extend") && (
                <Button
                  variant="secondary"
                  size="l"
                  icon="calendar"
                  onClick={() => setModal("extend")}
                >
                  Продлить
                </Button>
              )}
              <TicketButton
                ticketUrl={loan.ticket_url}
                ticketNumber={loan.ticket_number}
                size="l"
              />
            </div>
            {loan.status === "REPAID" && (
              <Alert tone="success" title="Займ погашен">
                Вызовите курьера, чтобы вернуть изделие, —{" "}
                <Link to={`/client/applications/${loan.application.id}`}>в карточке заявки</Link>.
              </Alert>
            )}
          </Card>

          <Card as="section" pad="l" className={styles.panel} aria-labelledby="payments">
            <h2 id="payments" className="t-h3">
              Платежи
            </h2>
            {loan.payments.length === 0 ? (
              <p className={styles.muted}>Платежей пока нет.</p>
            ) : (
              <ul className={styles.payments} role="list">
                {[...loan.payments].reverse().map((p) => (
                  <li key={p.id} data-failed={p.status === "FAILED" || undefined}>
                    <span>
                      <span className={styles.payKind}>{p.kind_label}</span>
                      <span className={styles.appMeta}>
                        {formatDateTimeKz(p.created_at)}
                        {p.destination ? `, карта ${p.destination}` : ""}
                        {p.status !== "SUCCEEDED" ? ` — ${p.status_label.toLowerCase()}` : ""}
                      </span>
                    </span>
                    <span className={styles.payAmount}>
                      {p.kind === "DISBURSEMENT" ? "+" : "−"}
                      {formatTenge(p.amount)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <aside className={styles.side}>
          <Card pad="l" className={styles.sideCard}>
            <h2 className="t-h4">Условия</h2>
            <KeyValueList>
              <KeyValue label="Выдан" value={formatDayKz(loan.issued_at)} />
              <KeyValue label="Срок периода" value={days(loan.term_days)} />
              <KeyValue label="Вернуть до" value={formatDate(loan.due_date)} />
              <KeyValue label="Льготный период до" value={formatDate(loan.grace_until)} />
              <KeyValue
                label="Продлений"
                value={`${loan.extensions_count}, осталось ${loan.extensions_left}`}
              />
            </KeyValueList>
            <p className={styles.sideNote}>
              Проценты начисляются за фактические дни: вернуть деньги можно в любой день без штрафа.
            </p>
          </Card>
        </aside>
      </div>

      <RepayModal loan={loan} open={modal === "repay"} onClose={() => setModal(null)} />
      {modal === "extend" && <ExtendModal loan={loan} onClose={() => setModal(null)} />}
    </div>
  );
}

function RepayModal({ loan, open, onClose }: { loan: Loan; open: boolean; onClose: () => void }) {
  const update = useLoanUpdate();
  const toast = useToast();
  const [card, setCard] = useState("");
  const [error, setError] = useState<string>();
  const repay = useMutation({
    mutationFn: () => loansApi.repay(loan.id, cardDigits(card)),
    onSuccess: (next) => {
      update(next);
      onClose();
      toast.show({ title: "Займ погашен", text: "Теперь можно вызвать курьера с изделием" });
    },
    onError: (err) => setError(err.message),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!isCardValid(card)) return setError("Проверьте номер карты — в нём ошибка");
    setError(undefined);
    repay.mutate();
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Погасить займ"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Отмена
          </Button>
          <Button type="submit" form="repay-form" loading={repay.isPending}>
            Оплатить {formatTenge(loan.total_to_repay)}
          </Button>
        </>
      }
    >
      <form id="repay-form" onSubmit={submit} noValidate className={styles.modalForm}>
        <KeyValueList>
          <KeyValue label="Сумма займа" value={formatTenge(loan.principal)} />
          <KeyValue
            label={`Проценты за ${days(loan.days_used)}`}
            value={formatTenge(loan.accrued_interest)}
          />
          <KeyValue label="Итого" value={formatTenge(loan.total_to_repay)} emphasis />
        </KeyValueList>
        <CardField
          value={card}
          onChange={(v) => {
            setCard(v);
            setError(undefined);
          }}
          error={error}
          label="Карта для оплаты"
        />
      </form>
    </Modal>
  );
}

const TERMS = [7, 14, 30, 60];

function ExtendModal({ loan, onClose }: { loan: Loan; onClose: () => void }) {
  const update = useLoanUpdate();
  const toast = useToast();
  const [term, setTerm] = useState(String(TERMS.includes(loan.term_days) ? loan.term_days : 30));
  const [card, setCard] = useState("");
  const [error, setError] = useState<string>();
  const quote = useQuery({
    queryKey: ["loan", loan.id, "extension", term],
    queryFn: () => loansApi.extensionQuote(loan.id, Number(term)),
    placeholderData: keepPreviousData,
  });
  const extend = useMutation({
    mutationFn: () => loansApi.extend(loan.id, cardDigits(card), Number(term)),
    onSuccess: (next) => {
      update(next);
      onClose();
      toast.show({ title: "Займ продлён", text: `Новый срок — ${formatDate(next.due_date)}` });
    },
    onError: (err) => setError(err.message),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!isCardValid(card)) return setError("Проверьте номер карты — в нём ошибка");
    setError(undefined);
    extend.mutate();
  };
  const q = quote.data;
  return (
    <Modal
      open
      onClose={onClose}
      title="Продлить займ"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Отмена
          </Button>
          <Button
            type="submit"
            form="extend-form"
            loading={extend.isPending}
            disabled={!q || quote.isError}
          >
            {q ? `Оплатить ${formatTenge(q.pay_now)}` : "Оплатить"}
          </Button>
        </>
      }
    >
      <form id="extend-form" onSubmit={submit} noValidate className={styles.modalForm}>
        <p>Оплатите проценты, начисленные на сегодня, — новый срок начнётся с сегодняшнего дня.</p>
        <div className={styles.fieldGroup}>
          <span className={styles.groupLabel}>Новый срок</span>
          <Segmented
            label="Новый срок"
            value={term}
            onChange={setTerm}
            options={TERMS.map((t) => ({ value: String(t), label: days(t) }))}
          />
        </div>
        {quote.isError ? (
          <Alert tone="danger" title={quote.error.message} />
        ) : !q ? (
          <Spinner label="Считаем" />
        ) : (
          <KeyValueList>
            <KeyValue
              label={`Проценты за ${days(q.days_used)}`}
              value={formatTenge(q.pay_now)}
              emphasis
            />
            <KeyValue label="Новый срок возврата" value={formatDate(q.new_due_date)} />
            <KeyValue label="К возврату в новый срок" value={formatTenge(q.total_at_new_due)} />
            <KeyValue label="Останется продлений" value={String(q.extensions_left)} />
          </KeyValueList>
        )}
        <CardField
          value={card}
          onChange={(v) => {
            setCard(v);
            setError(undefined);
          }}
          error={error}
          label="Карта для оплаты"
        />
      </form>
    </Modal>
  );
}
