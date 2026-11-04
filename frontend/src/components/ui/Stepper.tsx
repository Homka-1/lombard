import styles from "./Stepper.module.css";
import { Icon } from "./Icon";

/** Шаги мастера заявки: пройденные — с галочкой, текущий — залитый номер. */
export function Stepper({ steps, current }: { steps: readonly string[]; current: number }) {
  return (
    <ol className={styles.stepper} role="list">
      {steps.map((label, i) => {
        const state = i < current ? "done" : i === current ? "current" : "todo";
        return (
          <li
            key={label}
            className={styles.step}
            data-state={state}
            aria-current={state === "current" ? "step" : undefined}
          >
            <span className={styles.marker}>
              {state === "done" ? <Icon name="check" size={16} strokeWidth={2.3} /> : i + 1}
            </span>
            <span className={styles.label}>
              {label}
              {state === "done" && <span className="visually-hidden"> — готово</span>}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
