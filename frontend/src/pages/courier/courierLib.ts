import type { CourierStep, CourierTask } from "../../api/types";

/** Шаги выезда для полоски прогресса. Возврат: курьер забирает изделие в ломбарде при выезде. */
export function taskSteps(task: CourierTask): { label: string; done: boolean }[] {
  const order = ["SCHEDULED", "EN_ROUTE", "PICKED_UP", "DELIVERED"];
  const at = order.indexOf(task.status);
  if (task.kind === "RETURN")
    return [
      { label: "Выехал", done: at >= 1 },
      { label: "Передал клиенту", done: at >= 3 },
    ];
  return [
    { label: "Выехал", done: at >= 1 },
    { label: "Забрал", done: at >= 2 },
    { label: "Доставил", done: at >= 3 },
  ];
}

/** Подпись главной кнопки: что курьер подтверждает этим нажатием. */
export function stepLabel(task: CourierTask, step: CourierStep): string {
  if (step === "start") return task.kind === "RETURN" ? "Выехал с изделием" : "Выехал к клиенту";
  if (step === "pick_up") return "Изделие у меня";
  return task.kind === "RETURN" ? "Передал клиенту" : "Доставил в ломбард";
}
