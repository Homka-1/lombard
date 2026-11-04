import type { ReactNode } from "react";
import { STATUS, type ApplicationStatus, type Tone } from "../../design/status.gen";
import styles from "./Feedback.module.css";
import { Icon } from "./Icon";

export function Badge({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span className={styles.badge} data-tone={tone}>
      <span className={styles.dot} aria-hidden="true" />
      {children}
    </span>
  );
}

/** Бейдж статуса заявки: подпись и цвет — из design/tokens.json (`status`). */
export function StatusBadge({ status }: { status: string }) {
  const meta = STATUS[status as ApplicationStatus];
  if (!meta) return <Badge>{status}</Badge>;
  return <Badge tone={meta.tone}>{meta.label}</Badge>;
}

export function Chip({
  active,
  children,
  onClick,
}: {
  active?: boolean;
  children: ReactNode;
  onClick?: () => void;
}) {
  return (
    <button type="button" className={styles.chip} aria-pressed={!!active} onClick={onClick}>
      {children}
    </button>
  );
}

export function Spinner({ label = "Загрузка" }: { label?: string }) {
  return <span className={styles.spinner} role="status" aria-label={label} />;
}

export function PageLoader() {
  return (
    <div className={styles.pageLoader}>
      <Spinner />
    </div>
  );
}

type AlertTone = "info" | "success" | "warning" | "danger";

const ALERT_ICON = { info: "info", success: "check", warning: "alert", danger: "alert" } as const;

/** Сообщение внутри страницы: ошибка формы, подсказка, результат действия. */
export function Alert({
  tone = "info",
  title,
  children,
  action,
}: {
  tone?: AlertTone;
  title?: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className={styles.alert} data-tone={tone} role={tone === "danger" ? "alert" : "status"}>
      <Icon name={ALERT_ICON[tone]} size={20} className={styles.alertIcon} />
      <div className={styles.alertBody}>
        {title && <p className={styles.alertTitle}>{title}</p>}
        {children && <div className={styles.alertText}>{children}</div>}
      </div>
      {action}
    </div>
  );
}
