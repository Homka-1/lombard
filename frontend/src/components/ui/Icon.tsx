import type { SVGProps } from "react";
import { ICON_PATHS, type IconName } from "../icons.gen";

interface IconProps extends Omit<SVGProps<SVGSVGElement>, "name"> {
  name: IconName;
  size?: number;
  /** Подпись для скринридеров; без неё иконка декоративная. */
  label?: string;
}

/** Линейные иконки макета (сетка 24×24), цвет — currentColor. */
export function Icon({ name, size = 20, label, strokeWidth = 1.75, ...rest }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
      {...rest}
    >
      <path d={ICON_PATHS[name]} />
    </svg>
  );
}
