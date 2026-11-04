import type { ReactNode } from "react";
import styles from "./Accordion.module.css";
import { Icon } from "./Icon";

export interface AccordionItem {
  id: string;
  title: string;
  content: ReactNode;
}

/**
 * Список вопросов на `<details>`: работает с клавиатуры и без JavaScript.
 * Открыт может быть любой набор пунктов.
 */
export function Accordion({
  items,
  defaultOpen,
}: {
  items: AccordionItem[];
  defaultOpen?: string;
}) {
  return (
    <div className={styles.accordion}>
      {items.map((item) => (
        <details key={item.id} className={styles.item} open={item.id === defaultOpen}>
          <summary className={styles.summary}>
            <span>{item.title}</span>
            <Icon name="plus" size={20} className={styles.plus} />
            <Icon name="minus" size={20} className={styles.minus} />
          </summary>
          <div className={styles.content}>{item.content}</div>
        </details>
      ))}
    </div>
  );
}
