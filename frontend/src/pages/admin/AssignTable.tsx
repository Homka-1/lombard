import type { CourierLoad, CourierTask } from "../../api/types";
import { Badge } from "../../components/ui/Feedback";
import { Select } from "../../components/ui/Form";
import { dayKz, formatSlotDay, formatTimeKz } from "../../lib/time";
import { courierLoadLabel } from "./adminLib";
import { useAssign } from "./useAssign";
import styles from "./Admin.module.css";

/** Таблица выездов: заявка, адрес и интервал, курьер (или выбор курьера). */
export function AssignTable({
  tasks,
  couriers,
  showStatus,
}: {
  tasks: CourierTask[];
  couriers: CourierLoad[];
  showStatus?: boolean;
}) {
  const assign = useAssign();
  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th scope="col">Заявка</th>
            <th scope="col">Адрес и время</th>
            {showStatus && <th scope="col">Статус</th>}
            <th scope="col">Курьер</th>
          </tr>
        </thead>
        <tbody>
          {tasks.map((t) => {
            const local = couriers.filter((c) => c.courier.city === t.city);
            const options = local.length ? local : couriers;
            const canAssign = t.actions.includes("assign");
            const load = t.courier && couriers.find((c) => c.courier.id === t.courier!.id);
            return (
              <tr key={t.id}>
                <td>
                  <strong className={styles.nowrap}>№ {t.application.number}</strong>
                  <span className={styles.cellSub}>
                    {t.kind === "RETURN" ? "Возврат" : t.application.title}
                  </span>
                </td>
                <td>
                  {t.address}
                  <span className={styles.cellSub}>
                    {t.city}, {formatSlotDay(dayKz(t.slot_start))}, {formatTimeKz(t.slot_start)}–
                    {formatTimeKz(t.slot_end)}
                  </span>
                </td>
                {showStatus && (
                  <td>
                    <Badge tone={t.status === "DELIVERED" ? "success" : "info"}>
                      {t.status_label}
                    </Badge>
                  </td>
                )}
                <td className={styles.courierCell}>
                  {canAssign ? (
                    <Select
                      aria-label={`Курьер для заявки № ${t.application.number}`}
                      value={t.courier?.id ?? ""}
                      disabled={assign.isPending}
                      onChange={(e) =>
                        e.target.value &&
                        assign.mutate([{ taskId: t.id, courierId: Number(e.target.value) }])
                      }
                    >
                      <option value="" disabled>
                        Выбрать курьера
                      </option>
                      {options.map((c) => (
                        <option key={c.courier.id} value={c.courier.id}>
                          {c.courier.full_name}, {courierLoadLabel(c.open_tasks)}
                        </option>
                      ))}
                    </Select>
                  ) : t.courier ? (
                    <>
                      <strong>{t.courier.full_name}</strong>
                      {load && (
                        <span className={styles.cellSub}>{courierLoadLabel(load.open_tasks)}</span>
                      )}
                    </>
                  ) : (
                    <span className={styles.cellSub}>Не назначен</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
