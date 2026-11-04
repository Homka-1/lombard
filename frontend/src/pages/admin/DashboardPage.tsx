import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";
import { adminApi } from "../../api/endpoints";
import type { ClockState, JobsResult, Stats } from "../../api/types";
import { Button, ButtonLink } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { Alert, PageLoader } from "../../components/ui/Feedback";
import { Segmented } from "../../components/ui/Form";
import { useToast } from "../../components/ui/Toast";
import { days, formatTenge, NBSP } from "../../lib/format";
import { dayKz, formatDateTimeKz, formatDayKz } from "../../lib/time";
import { AssignTable } from "./AssignTable";
import { useAssign } from "./useAssign";
import { BarChart } from "./BarChart";
import {
  autoAssignPlan,
  formatChange,
  formatTengeCompact,
  issuedByDay,
  METAL_LABEL,
  metalRows,
  overdueShare,
  stageCounts,
} from "./adminLib";
import styles from "./Admin.module.css";

type Period = "week" | "month";
const PERIOD_DAYS: Record<Period, number> = { week: 7, month: 30 };
const WEEKDAY = ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];
const WEEKDAY_FULL = [
  "Воскресенье",
  "Понедельник",
  "Вторник",
  "Среда",
  "Четверг",
  "Пятница",
  "Суббота",
];

const loansWord = (n: number) => {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return "займ";
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return "займа";
  return "займов";
};

export function DashboardPage() {
  const [period, setPeriod] = useState<Period>("week");
  const stats = useQuery({
    queryKey: ["admin", "stats"],
    queryFn: adminApi.stats,
    refetchInterval: 60_000,
  });
  const loans = useQuery({ queryKey: ["admin", "loans"], queryFn: adminApi.loans });

  if (stats.isPending) return <PageLoader />;
  if (stats.isError)
    return (
      <Alert tone="danger" title="Не удалось загрузить статистику">
        {stats.error.message}
      </Alert>
    );

  const s = stats.data;
  const today = dayKz(s.now);
  const buckets = issuedByDay(loans.data ?? [], today, PERIOD_DAYS[period]);
  const issued = buckets.reduce((a, b) => a + b.amount, 0);
  const issuedCount = buckets.reduce((a, b) => a + b.count, 0);
  const first = buckets[0]!.date;
  const unit = axisUnit(Math.max(0, ...buckets.map((b) => b.amount)));

  return (
    <div className={styles.page}>
      <header className={styles.pageHead}>
        <div>
          <h1 className="t-h1">Обзор</h1>
          <p className={styles.subline}>
            {period === "week" ? "Неделя" : "30 дней"} {formatDayKz(`${first}T12:00:00Z`)} —{" "}
            {formatDayKz(`${today}T12:00:00Z`)}, данные на {formatDateTimeKz(s.now)}
          </p>
        </div>
        <Segmented
          label="Период"
          options={[
            { value: "week", label: "Неделя" },
            { value: "month", label: "Месяц" },
          ]}
          value={period}
          onChange={setPeriod}
        />
      </header>

      <div className={styles.tiles}>
        <Tile
          label="Выдано займов"
          value={formatTengeCompact(issued)}
          note={`${issuedCount} ${loansWord(issuedCount)} за период`}
          extra={`Всего ${formatTengeCompact(s.issued_total)}`}
        />
        <Tile
          label="Активные займы"
          value={String(s.loans_active + s.loans_overdue)}
          note={`Портфель ${formatTengeCompact(s.portfolio_principal)}`}
          extra={`Проценты на сегодня ${formatTengeCompact(s.accrued_interest)}`}
        />
        <Tile
          label="В очереди у экспертов"
          value={String(s.by_status.PRE_ESTIMATED ?? 0)}
          note={`В работе у экспертов: ${(s.by_status.UNDER_REVIEW ?? 0) + (s.by_status.NEED_INFO ?? 0)}`}
        />
        <Tile
          label="Просрочка"
          value={`${overdueShare(s).toLocaleString("ru-RU", { maximumFractionDigits: 1 })}${NBSP}%`}
          danger={s.loans_overdue > 0}
          note={`${s.loans_overdue} ${loansWord(s.loans_overdue)} в льготном периоде`}
          extra={`Срок скоро: ${s.loans_due_soon}`}
        />
      </div>

      <div className={styles.dashGrid}>
        <Card pad="l" className={styles.panel}>
          <h2 className="t-h4">Выдано по дням, {unit.label}</h2>
          {loans.isError ? (
            <Alert tone="danger" title="Не удалось загрузить займы">
              {loans.error.message}
            </Alert>
          ) : loans.isPending ? (
            <PageLoader />
          ) : issued === 0 ? (
            <p className={styles.muted}>
              За период займов не выдавали. Данные появятся после первой выплаты клиенту.
            </p>
          ) : (
            <BarChart
              caption={`Выдано займов по дням: всего ${formatTenge(issued)}`}
              unitLabel="Выдано"
              formatTick={(v) => formatAxis(v, unit.div)}
              bars={buckets.map((b, i) => {
                const d = new Date(`${b.date}T12:00:00Z`);
                return {
                  key: b.date,
                  label:
                    period === "week"
                      ? WEEKDAY[d.getUTCDay()]!
                      : i % 5 === 4 || i === buckets.length - 1
                        ? String(d.getUTCDate())
                        : "",
                  value: b.amount,
                  title: `${WEEKDAY_FULL[d.getUTCDay()]}, ${formatDayKz(`${b.date}T12:00:00Z`)}`,
                  detail: `${formatTengeCompact(b.amount)}, ${b.count} ${loansWord(b.count)}`,
                };
              })}
            />
          )}
        </Card>
        <StagesCard stats={s} />
        <WaitingCourier />
        <MetalsCard />
      </div>
      <ClockCard />
    </div>
  );
}

/** Подписи оси: в млн ₸, если суммы большие, иначе в тыс. ₸. */
/** Единица оси по масштабу сумм: млн ₸ для крупных, иначе тыс. ₸. */
function axisUnit(maxTiyn: number): { label: string; div: number } {
  return maxTiyn / 100 >= 1_000_000
    ? { label: "млн ₸", div: 100_000_000 }
    : { label: "тыс. ₸", div: 100_000 };
}

function formatAxis(tiyn: number, div: number) {
  return (tiyn / div).toLocaleString("ru-RU", { maximumFractionDigits: 1 });
}

function Tile({
  label,
  value,
  note,
  extra,
  danger,
}: {
  label: string;
  value: string;
  note: string;
  extra?: string;
  danger?: boolean;
}) {
  return (
    <Card pad="m" className={styles.tile}>
      <p className={styles.tileLabel}>{label}</p>
      <p className={styles.tileValue} data-danger={danger || undefined}>
        {value}
      </p>
      <p className={styles.tileNote}>{note}</p>
      {extra && <p className={styles.tileNote}>{extra}</p>}
    </Card>
  );
}

function StagesCard({ stats }: { stats: Stats }) {
  const stages = stageCounts(stats);
  const max = Math.max(1, ...stages.map((s) => s.count));
  return (
    <Card pad="l" className={styles.panel}>
      <h2 className="t-h4">Заявки по этапам</h2>
      <ul className={styles.stages} role="list">
        {stages.map((s) => (
          <li key={s.label}>
            <span>{s.label}</span>
            <strong>{s.count}</strong>
            <span className={styles.stageBar} aria-hidden="true">
              <span style={{ width: `${(s.count / max) * 100}%` }} />
            </span>
          </li>
        ))}
      </ul>
      <p className={styles.muted}>
        Всего заявок: {stats.applications_total}, закрыто {stats.funnel.closed}, отказов{" "}
        {stats.funnel.declined}
      </p>
    </Card>
  );
}

function WaitingCourier() {
  const tasks = useQuery({
    queryKey: ["admin", "tasks", "active"],
    queryFn: () => adminApi.tasks({ scope: "active" }),
  });
  const couriers = useQuery({ queryKey: ["admin", "couriers"], queryFn: adminApi.couriers });
  const assign = useAssign();
  const waiting = (tasks.data ?? []).filter((t) => t.status === "SCHEDULED").slice(0, 5);
  const plan = autoAssignPlan(tasks.data ?? [], couriers.data ?? []);

  return (
    <Card pad="l" className={styles.panel}>
      <div className={styles.panelHead}>
        <h2 className="t-h4">Ждут курьера</h2>
        {plan.length > 0 && (
          <Button
            variant="ghost"
            size="s"
            loading={assign.isPending}
            onClick={() => assign.mutate(plan)}
          >
            Назначить автоматически
          </Button>
        )}
      </div>
      {tasks.isPending || couriers.isPending ? (
        <PageLoader />
      ) : tasks.isError || couriers.isError ? (
        <Alert tone="danger" title="Не удалось загрузить выезды" />
      ) : waiting.length === 0 ? (
        <p className={styles.muted}>Все выезды уже в пути или выполнены.</p>
      ) : (
        <>
          <AssignTable tasks={waiting} couriers={couriers.data} />
          <Link to="/admin/couriers" className={styles.more}>
            Все выезды и загрузка курьеров
          </Link>
        </>
      )}
    </Card>
  );
}

function MetalsCard() {
  const prices = useQuery({ queryKey: ["admin", "metal-prices"], queryFn: adminApi.metalPrices });
  const rows = metalRows(prices.data ?? []);
  const updated = rows.reduce<string | null>(
    (a, r) => (!a || r.current.effective_from > a ? r.current.effective_from : a),
    null,
  );
  return (
    <Card pad="l" className={styles.panel}>
      <div>
        <h2 className="t-h4">Цены металлов, ₸ за грамм</h2>
        {updated && (
          <p className={styles.caption}>Проба 999, обновлено {formatDateTimeKz(updated)}</p>
        )}
      </div>
      {prices.isPending ? (
        <PageLoader />
      ) : prices.isError ? (
        <Alert tone="danger" title="Не удалось загрузить цены" />
      ) : (
        <dl className={styles.metals}>
          {rows.map((r) => (
            <div key={r.metal}>
              <dt>{METAL_LABEL[r.metal]} 999</dt>
              <dd>{formatTenge(r.current.price_per_gram, { sign: false })}</dd>
              <dd data-trend={r.change === null ? undefined : r.change >= 0 ? "up" : "down"}>
                {r.change === null ? "" : formatChange(r.change)}
              </dd>
            </div>
          ))}
        </dl>
      )}
      <ButtonLink to="/admin/catalog#metals" variant="secondary" size="s">
        Изменить цены
      </ButtonLink>
    </Card>
  );
}

function jobsText(j: JobsResult | null | undefined): string | undefined {
  if (!j) return undefined;
  return `Истекло предложений: ${j.offers_expired}, в просрочку: ${j.loans_overdue}, изъято: ${j.loans_forfeited}`;
}

/** Перемотка времени для демонстрации продления, просрочки и изъятия залога. */
function ClockCard() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const clock = useQuery({ queryKey: ["admin", "clock"], queryFn: adminApi.clock });
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["admin"] });
    void queryClient.invalidateQueries({ queryKey: ["loans"] });
  };
  const advance = useMutation({
    mutationFn: adminApi.advanceClock,
    onSuccess: (r, n) => {
      queryClient.setQueryData<ClockState>(["admin", "clock"], r);
      toast.show({ title: `Время перемотано на ${days(n)}`, text: jobsText(r.jobs), tone: "info" });
      refresh();
    },
    onError: (e) => toast.show({ title: "Не получилось", text: e.message, tone: "danger" }),
  });
  const reset = useMutation({
    mutationFn: adminApi.resetClock,
    onSuccess: (r) => {
      queryClient.setQueryData(["admin", "clock"], r);
      toast.show({ title: "Вернули реальное время", tone: "info" });
      refresh();
    },
  });
  const jobs = useMutation({
    mutationFn: adminApi.runJobs,
    onSuccess: (r) => {
      toast.show({ title: "Фоновые задачи выполнены", text: jobsText(r), tone: "success" });
      refresh();
    },
  });

  if (!clock.data) return null;
  const c = clock.data;
  const shifted = c.offset_seconds > 0;
  return (
    <Card pad="l" className={styles.clock}>
      <div>
        <h2 className="t-h4">Время приложения</h2>
        <p className={styles.caption}>
          {formatDateTimeKz(c.now)}
          {shifted &&
            `, впереди реального на ${c.offset_days.toLocaleString("ru-RU", { maximumFractionDigits: 1 })} дн.`}
        </p>
        <p className={styles.muted}>
          Для демонстрации: перемотка двигает сроки займов и сразу запускает проверку просрочек и
          истёкших предложений.
        </p>
      </div>
      {c.enabled ? (
        <div className={styles.clockActions}>
          {[1, 7, 30].map((n) => (
            <Button
              key={n}
              variant="secondary"
              size="s"
              disabled={advance.isPending}
              onClick={() => advance.mutate(n)}
            >
              +{days(n)}
            </Button>
          ))}
          {shifted && (
            <Button
              variant="ghost"
              size="s"
              loading={reset.isPending}
              onClick={() => reset.mutate()}
            >
              Вернуть реальное время
            </Button>
          )}
          <Button
            variant="ghost"
            size="s"
            icon="refresh"
            loading={jobs.isPending}
            onClick={() => jobs.mutate()}
          >
            Проверить просрочки
          </Button>
        </div>
      ) : (
        <p className={styles.muted}>
          Перемотка выключена в настройках сервера (LOMBARD_TIME_TRAVEL).
        </p>
      )}
    </Card>
  );
}
