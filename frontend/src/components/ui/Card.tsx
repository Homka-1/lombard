import type { HTMLAttributes, ReactNode } from "react";
import styles from "./Card.module.css";

interface CardProps extends HTMLAttributes<HTMLElement> {
  as?: "section" | "article" | "div" | "aside";
  /** Внутренние отступы: m — 24px, l — 32px (крупные карточки лэндинга). */
  pad?: "s" | "m" | "l";
}

/** Плоская карточка: белая поверхность, обводка 1px, радиус 12. */
export function Card({ as: Tag = "div", pad = "m", className, ...rest }: CardProps) {
  return (
    <Tag className={[styles.card, styles[pad], className].filter(Boolean).join(" ")} {...rest} />
  );
}

/** Строки «название — значение» (условия займа, оценка). */
export function KeyValueList({ children }: { children: ReactNode }) {
  return <dl className={styles.kv}>{children}</dl>;
}

export function KeyValue({
  label,
  value,
  emphasis,
}: {
  label: ReactNode;
  value: ReactNode;
  emphasis?: boolean;
}) {
  return (
    <div className={styles.kvRow} data-emphasis={emphasis || undefined}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
