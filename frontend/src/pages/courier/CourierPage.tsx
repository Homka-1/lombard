import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { courierApi } from "../../api/endpoints";
import type { CourierStep, CourierTask } from "../../api/types";
import { useAuth } from "../../auth/AuthContext";
import { Button } from "../../components/ui/Button";
import { Alert, Badge, PageLoader } from "../../components/ui/Feedback";
import { Segmented } from "../../components/ui/Form";
import { Icon } from "../../components/ui/Icon";
import { useToast } from "../../components/ui/Toast";
import type { Tone } from "../../design/status.gen";
import { initials } from "../../lib/format";
import { addDaysIso, formatRelativeDay, formatTimeKz, todayKz } from "../../lib/time";
import { stepLabel, taskSteps } from "./courierLib";
import styles from "./Courier.module.css";

const TASK_TONE: Record<CourierTask["status"], Tone> = {
  SCHEDULED: "neutral",
  EN_ROUTE: "info",
  PICKED_UP: "gold",
  DELIVERED: "success",
  CANCELLED: "neutral",
};

const isOpen = (t: CourierTask) => t.status !== "DELIVERED" && t.status !== "CANCELLED";

const STEP_DONE: Record<CourierStep, string> = {
  start: "Клиент получил уведомление, что вы в пути",
  pick_up: "Изделие у вас — везите в ломбард",
  deliver: "Выезд завершён",
};

const taskTitle = (t: CourierTask) => (t.kind === "RETURN" ? "Вернуть изделие" : "Забрать изделие");
const slotTime = (t: CourierTask) => `${formatTimeKz(t.slot_start)}–${formatTimeKz(t.slot_end)}`;

export function CourierPage() {
  const { user } = useAuth();
  const [day, setDay] = useState(() => todayKz());
  const [tab, setTab] = useState<"active" | "done">("active");
  const [openId, setOpenId] = useState<number | null>(null);
  const tasks = useQuery({
    queryKey: ["courier", "tasks", day],
    queryFn: () => courierApi.tasks("day", day),
    refetchInterval: 60_000,
  });

  const list = tasks.data ?? [];
  const active = list.filter(isOpen);
  const done = list.filter((t) => !isOpen(t));
  const shown = tab === "active" ? active : done;
  const expanded = openId ?? (tab === "active" ? active[0]?.id : undefined);
  const next = active.find((t) => t.status === "SCHEDULED");
  const pct = list.length ? (done.length / list.length) * 100 : 0;

  const shift = (n: number) => {
    setDay((d) => addDaysIso(d, n));
    setOpenId(null);
  };

  return (
    <div className={styles.page}>
      <header className={styles.head}>
        {user && <p className={styles.who}>{user.full_name}, курьер</p>}
        <div className={styles.dayRow}>
          <h1 className={styles.day}>{formatRelativeDay(day)}</h1>
          <div className={styles.dayNav}>
            <button type="button" onClick={() => shift(-1)} aria-label="Предыдущий день">
              <Icon name="chevronLeft" size={20} />
            </button>
            <button type="button" onClick={() => shift(1)} aria-label="Следующий день">
              <Icon name="chevronRight" size={20} />
            </button>
          </div>
        </div>
        {tasks.data && (
          <>
            <p className={styles.progressText}>
              {list.length === 0
                ? "Выездов нет"
                : `${done.length} из ${list.length} ${plural(list.length)} выполнено`}
            </p>
            <span
              className={styles.progress}
              role="progressbar"
              aria-label="Выполнено выездов"
              aria-valuemin={0}
              aria-valuemax={list.length}
              aria-valuenow={done.length}
            >
              <span style={{ width: `${pct}%` }} />
            </span>
            {next && (
              <p className={styles.nextRow}>
                Следующий выезд — {formatTimeKz(next.slot_start)}, {next.address}
              </p>
            )}
          </>
        )}
      </header>

      {tasks.isPending ? (
        <PageLoader />
      ) : tasks.isError ? (
        <Alert tone="danger" title="Не удалось загрузить выезды">
          {tasks.error.message}
        </Alert>
      ) : (
        <>
          <Segmented
            label="Какие выезды показать"
            options={[
              { value: "active", label: `Активные, ${active.length}` },
              { value: "done", label: `Выполненные, ${done.length}` },
            ]}
            value={tab}
            onChange={(v) => {
              setTab(v);
              setOpenId(null);
            }}
            className={styles.tabs}
          />
          {shown.length === 0 ? (
            <p className={styles.empty}>
              {tab === "active"
                ? list.length
                  ? "Все выезды на этот день выполнены."
                  : "На этот день выездов нет. Новые появятся, когда клиенты выберут время визита."
                : "Выполненных выездов пока нет."}
            </p>
          ) : (
            <ul className={styles.list} role="list">
              {shown.map((t) => (
                <li key={t.id}>
                  {t.id === expanded ? (
                    <TaskCard task={t} />
                  ) : (
                    <TaskRow task={t} onOpen={() => setOpenId(t.id)} />
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

function plural(n: number) {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return "выезда";
  return "выездов";
}

function TaskRow({ task, onOpen }: { task: CourierTask; onOpen: () => void }) {
  return (
    <button type="button" className={styles.row} onClick={onOpen} aria-expanded={false}>
      <span className={styles.rowTop}>
        <span className={styles.time}>{slotTime(task)}</span>
        <Badge tone={TASK_TONE[task.status]}>
          {task.kind === "RETURN" && task.status === "SCHEDULED" ? "Возврат" : task.status_label}
        </Badge>
      </span>
      <span className={styles.rowTitle}>{taskTitle(task)}</span>
      <span className={styles.address}>
        <Icon name="pin" size={18} />
        <span>
          {task.address}
          <span className={styles.sub}>
            {task.application.title}, заявка № {task.application.number}
            {task.completed_at ? `, ${formatTimeKz(task.completed_at)}` : ""}
          </span>
        </span>
      </span>
      <Icon name="chevronRight" size={20} className={styles.rowChevron} />
    </button>
  );
}

function TaskCard({ task }: { task: CourierTask }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const step = task.actions.find((a): a is CourierStep => a !== "assign");
  const run = useMutation({
    mutationFn: (s: CourierStep) => courierApi.step(task.id, s),
    onSuccess: (_next, s) => {
      void queryClient.invalidateQueries({ queryKey: ["courier"] });
      toast.show({ title: STEP_DONE[s], tone: "success" });
    },
  });
  const steps = taskSteps(task);
  const mapUrl = `https://2gis.kz/search/${encodeURIComponent(`${task.city}, ${task.address}`)}`;

  return (
    <article className={styles.card} aria-label={`${taskTitle(task)}, ${slotTime(task)}`}>
      <div className={styles.rowTop}>
        <Badge tone={TASK_TONE[task.status]}>{task.status_label}</Badge>
        <span className={styles.time}>{slotTime(task)}</span>
      </div>
      <h2 className={styles.cardTitle}>{taskTitle(task)}</h2>
      <p className={styles.addressBig}>
        <Icon name="pin" size={20} />
        <span>
          {task.address}
          <span className={styles.sub}>
            {task.city}
            {task.comment ? `, ${task.comment}` : ""}
          </span>
        </span>
      </p>
      {isOpen(task) && (
        <a href={mapUrl} target="_blank" rel="noreferrer" className={styles.mapLink}>
          <Icon name="route" size={18} />
          Маршрут в 2ГИС
        </a>
      )}

      <div className={styles.contact}>
        <span className={styles.avatar} aria-hidden="true">
          {initials(task.client.full_name)}
        </span>
        <span className={styles.contactText}>
          <strong>{task.client.full_name}</strong>
          <span>{task.contact_phone_display}</span>
        </span>
        <a
          href={`tel:${task.contact_phone}`}
          className={styles.call}
          aria-label={`Позвонить: ${task.contact_phone_display}`}
        >
          <Icon name="phone" size={22} />
        </a>
      </div>

      <div className={styles.item}>
        <Icon name="tag" size={22} />
        <span>
          <strong>
            {task.application.title}, заявка № {task.application.number}
          </strong>
          <span className={styles.sub}>
            {task.application.category_name}, {task.kind_label.toLowerCase()}
          </span>
        </span>
      </div>

      <ol className={styles.steps} role="list" aria-label="Ход выезда">
        {steps.map((s) => (
          <li key={s.label} data-done={s.done || undefined}>
            <span aria-hidden="true" />
            {s.label}
            {s.done && <span className="visually-hidden"> — выполнено</span>}
          </li>
        ))}
      </ol>

      {run.isError && (
        <Alert tone="danger" title="Статус не изменился">
          {run.error.message}
        </Alert>
      )}
      {step ? (
        <Button
          size="l"
          block
          icon="check"
          loading={run.isPending}
          onClick={() => run.mutate(step)}
        >
          {stepLabel(task, step)}
        </Button>
      ) : (
        task.completed_at && (
          <p className={styles.doneNote}>
            <Icon name="check" size={18} />
            {task.status === "DELIVERED" ? "Выполнено" : task.status_label} в{" "}
            {formatTimeKz(task.completed_at)}
          </p>
        )
      )}
    </article>
  );
}
