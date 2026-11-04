import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Link, type LinkProps } from "react-router-dom";
import type { IconName } from "../icons.gen";
import styles from "./Button.module.css";
import { Icon } from "./Icon";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "inverse" | "danger";
export type ButtonSize = "s" | "m" | "l";

interface CommonProps {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: IconName;
  /** Растянуть на всю ширину контейнера. */
  block?: boolean;
  children: ReactNode;
}

function classes(variant: ButtonVariant, size: ButtonSize, block?: boolean, extra?: string) {
  return [styles.button, styles[variant], styles[size], block && styles.block, extra]
    .filter(Boolean)
    .join(" ");
}

type ButtonProps = CommonProps & ButtonHTMLAttributes<HTMLButtonElement> & { loading?: boolean };

export function Button({
  variant = "primary",
  size = "m",
  icon,
  block,
  loading,
  children,
  className,
  disabled,
  type = "button",
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={classes(variant, size, block, className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? (
        <span className={styles.spinner} aria-hidden="true" />
      ) : (
        icon && <Icon name={icon} size={18} strokeWidth={1.9} />
      )}
      <span>{children}</span>
    </button>
  );
}

type ButtonLinkProps = CommonProps & LinkProps;

/** Ссылка, оформленная как кнопка (переход на другую страницу или якорь). */
export function ButtonLink({
  variant = "primary",
  size = "m",
  icon,
  block,
  children,
  className,
  ...rest
}: ButtonLinkProps) {
  return (
    <Link className={classes(variant, size, block, className)} {...rest}>
      {icon && <Icon name={icon} size={18} strokeWidth={1.9} />}
      <span>{children}</span>
    </Link>
  );
}
