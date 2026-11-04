import { Link } from "react-router-dom";
import styles from "./Brand.module.css";

/** Клеймо пробы — единственный фирменный элемент: тонкий восьмиугольник с числом. */
export function Hallmark({
  children,
  tone = "gold",
  label,
}: {
  children: string;
  /** gold — проба золота, silver — серебро/нейтральное, malachite — уверенность оценки. */
  tone?: "gold" | "silver" | "malachite";
  label?: string;
}) {
  return (
    <span
      className={styles.hallmark}
      data-tone={tone}
      aria-label={label}
      role={label ? "img" : undefined}
    >
      <svg viewBox="0 0 74 40" preserveAspectRatio="none" aria-hidden="true">
        <path
          d="M9 .6H65L73.4 9V31L65 39.4H9L.6 31V9Z"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.25"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <span aria-hidden={label ? true : undefined}>{children}</span>
    </span>
  );
}

export function Logo({ to = "/", inverse }: { to?: string; inverse?: boolean }) {
  return (
    <Link to={to} className={styles.logo} data-inverse={inverse || undefined}>
      <span className={styles.mark} aria-hidden="true">
        Л
      </span>
      <span className={styles.word}>Ломбард онлайн</span>
    </Link>
  );
}
