import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { adminApi, type AdminTaskFilter } from "../../api/endpoints";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { Alert, PageLoader } from "../../components/ui/Feedback";
import { Segmented } from "../../components/ui/Form";
import { initials } from "../../lib/format";
import { AssignTable } from "./AssignTable";
import { useAssign } from "./useAssign";
import { autoAssignPlan } from "./adminLib";
import styles from "./Admin.module.css";

type Tab = "active" | "unassigned" | "today" | "done";

const FILTERS: Record<Tab, AdminTaskFilter> = {
  active: { scope: "active" },
  unassigned: { scope: "active", unassigned: true },
  today: { scope: "day" },
  done: { scope: "done" },
};

export function CouriersPage() {
  const [tab, setTab] = useState<Tab>("active");
  const couriers = useQuery({ queryKey: ["admin", "couriers"], queryFn: adminApi.couriers });
  const tasks = useQuery({
    queryKey: ["admin", "tasks", tab],
    queryFn: () => adminApi.tasks(FILTERS[tab]),
  });
  const assign = useAssign();
  const plan = autoAssignPlan(tasks.data ?? [], couriers.data ?? []);

  return (
    <div className={styles.page}>
      <header className={styles.pageHead}>
        <div>
          <h1 className="t-h1">Курьеры</h1>
          <p className={styles.subline}>
            Новый выезд сразу получает наименее загруженный курьер города. Здесь можно переназначить
            выезд, пока курьер не выехал.
          </p>
        </div>
      </header>

      {couriers.isPending ? (
        <PageLoader />
      ) : couriers.isError ? (
        <Alert tone="danger" title="Не удалось загрузить курьеров">
          {couriers.error.message}
        </Alert>
      ) : couriers.data.length === 0 ? (
        <Alert tone="warning" title="Нет активных курьеров">
          Добавьте сотрудника с ролью «Курьер» в разделе «Пользователи».
        </Alert>
      ) : (
        <ul className={styles.couriers} role="list">
          {couriers.data.map((c) => (
            <li key={c.courier.id}>
              <span className={styles.avatar} aria-hidden="true">
                {initials(c.courier.full_name)}
              </span>
              <span>
                <strong>{c.courier.full_name}</strong>
                <span className={styles.cellSub}>{c.courier.city ?? "Город не указан"}</span>
              </span>
              <span className={styles.load}>
                <strong>В работе: {c.open_tasks}</strong>
                <span className={styles.cellSub}>На сегодня: {c.today_tasks}</span>
              </span>
            </li>
          ))}
        </ul>
      )}

      <Card pad="l" className={styles.panel}>
        <div className={styles.panelHead}>
          <Segmented
            label="Какие выезды показать"
            options={[
              { value: "active", label: "Незавершённые" },
              { value: "unassigned", label: "Без курьера" },
              { value: "today", label: "Сегодня" },
              { value: "done", label: "Завершённые" },
            ]}
            value={tab}
            onChange={setTab}
          />
          {plan.length > 0 && (
            <Button
              variant="secondary"
              size="s"
              loading={assign.isPending}
              onClick={() => assign.mutate(plan)}
            >
              Назначить автоматически, {plan.length}
            </Button>
          )}
        </div>
        {tasks.isPending ? (
          <PageLoader />
        ) : tasks.isError ? (
          <Alert tone="danger" title="Не удалось загрузить выезды">
            {tasks.error.message}
          </Alert>
        ) : tasks.data.length === 0 ? (
          <p className={styles.muted}>
            {tab === "unassigned" ? "Все выезды распределены." : "Выездов нет."}
          </p>
        ) : (
          <AssignTable tasks={tasks.data} couriers={couriers.data ?? []} showStatus />
        )}
      </Card>
    </div>
  );
}
