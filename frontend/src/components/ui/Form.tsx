import { forwardRef, useId } from "react";
import type {
  CSSProperties,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";
import styles from "./Form.module.css";
import { Icon } from "./Icon";

interface FieldRenderProps {
  id: string;
  "aria-describedby"?: string;
  "aria-invalid"?: true;
}

interface FieldProps {
  label: ReactNode;
  hint?: ReactNode;
  error?: string;
  /** Подпись справа от названия поля (например, значение слайдера). */
  aside?: ReactNode;
  className?: string;
  children: (control: FieldRenderProps) => ReactNode;
}

/** Обёртка поля: подпись, подсказка, ошибка; связывает их с контролом через id/aria. */
export function Field({ label, hint, error, aside, className, children }: FieldProps) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [errorId, hintId].filter(Boolean).join(" ") || undefined;
  return (
    <div className={[styles.field, className].filter(Boolean).join(" ")}>
      <div className={styles.labelRow}>
        <label htmlFor={id} className={styles.label}>
          {label}
        </label>
        {aside && <span className={styles.aside}>{aside}</span>}
      </div>
      {children({
        id,
        "aria-describedby": describedBy,
        "aria-invalid": error ? true : undefined,
      })}
      {error ? (
        <p id={errorId} className={styles.error}>
          {error}
        </p>
      ) : (
        hint && (
          <p id={hintId} className={styles.hint}>
            {hint}
          </p>
        )
      )}
    </div>
  );
}

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  /** Единица измерения внутри поля справа: «г», «₸». */
  suffix?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { suffix, className, ...rest },
  ref,
) {
  return (
    <span className={[styles.control, className].filter(Boolean).join(" ")}>
      <input ref={ref} className={styles.input} {...rest} />
      {suffix && (
        <span className={styles.suffix} aria-hidden="true">
          {suffix}
        </span>
      )}
    </span>
  );
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  function Select({ className, children, ...rest }, ref) {
    return (
      <span className={[styles.control, className].filter(Boolean).join(" ")}>
        <select ref={ref} className={`${styles.input} ${styles.select}`} {...rest}>
          {children}
        </select>
        <Icon name="chevronDown" size={20} className={styles.chevron} />
      </span>
    );
  },
);

interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
  label: ReactNode;
}

export function Checkbox({ label, className, ...rest }: CheckboxProps) {
  return (
    <label className={[styles.checkbox, className].filter(Boolean).join(" ")}>
      <input type="checkbox" {...rest} />
      <span className={styles.box} aria-hidden="true">
        <Icon name="check" size={16} strokeWidth={2.2} />
      </span>
      <span>{label}</span>
    </label>
  );
}

interface SegmentedProps<T extends string> {
  label: string;
  options: readonly { value: T; label: ReactNode }[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
}

/** Переключатель-сегменты (группа радиокнопок). */
export function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
  className,
}: SegmentedProps<T>) {
  const name = useId();
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={[styles.segmented, className].filter(Boolean).join(" ")}
    >
      {options.map((o) => (
        <label key={o.value} className={styles.segment}>
          <input
            type="radio"
            name={name}
            value={o.value}
            checked={o.value === value}
            onChange={() => onChange(o.value)}
          />
          <span>{o.label}</span>
        </label>
      ))}
    </div>
  );
}

interface SliderProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "onChange"> {
  min: number;
  max: number;
  value: number;
  onChange: (value: number) => void;
  minLabel?: string;
  maxLabel?: string;
}

/** Ползунок с заполненной частью дорожки и подписями краёв. */
export function Slider({ min, max, value, onChange, minLabel, maxLabel, ...rest }: SliderProps) {
  const pct = max > min ? ((value - min) / (max - min)) * 100 : 0;
  return (
    <div className={styles.slider}>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ "--fill": `${pct}%` } as CSSProperties}
        {...rest}
      />
      {(minLabel || maxLabel) && (
        <div className={styles.sliderEnds} aria-hidden="true">
          <span>{minLabel}</span>
          <span>{maxLabel}</span>
        </div>
      )}
    </div>
  );
}

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement>
>(function Textarea({ className, rows = 3, ...rest }, ref) {
  return (
    <span className={[styles.control, className].filter(Boolean).join(" ")}>
      <textarea ref={ref} rows={rows} className={`${styles.input} ${styles.textarea}`} {...rest} />
    </span>
  );
});

export interface Choice<T extends string> {
  value: T;
  label: ReactNode;
  /** Вторая строка плитки: «Сегодня», «LTV 80 %». */
  note?: ReactNode;
  disabled?: boolean;
}

interface ChoiceGroupProps<T extends string> {
  label: string;
  /** Подпись видна над плитками; без неё — только для скринридеров. */
  showLabel?: boolean;
  options: readonly Choice<T>[];
  value: T | null;
  onChange: (value: T) => void;
  /** tile — плитка с подписью (дни, категории), slot — компактная кнопка-интервал. */
  variant?: "tile" | "slot";
  error?: string;
  className?: string;
}

/** Выбор одного варианта плитками (категория, день, интервал) — нативные радиокнопки. */
export function ChoiceGroup<T extends string>({
  label,
  showLabel = true,
  options,
  value,
  onChange,
  variant = "tile",
  error,
  className,
}: ChoiceGroupProps<T>) {
  const name = useId();
  const errorId = `${name}-error`;
  return (
    <fieldset
      className={[styles.choices, className].filter(Boolean).join(" ")}
      aria-describedby={error ? errorId : undefined}
    >
      <legend className={showLabel ? styles.label : "visually-hidden"}>{label}</legend>
      <div className={styles.choiceGrid} data-variant={variant}>
        {options.map((o) => (
          <label key={o.value} className={styles.choice} data-disabled={o.disabled || undefined}>
            <input
              type="radio"
              name={name}
              value={o.value}
              checked={o.value === value}
              disabled={o.disabled}
              onChange={() => onChange(o.value)}
            />
            <span className={styles.choiceBody}>
              <span className={styles.choiceLabel}>{o.label}</span>
              {o.note && <span className={styles.choiceNote}>{o.note}</span>}
            </span>
          </label>
        ))}
      </div>
      {error && (
        <p id={errorId} className={styles.error}>
          {error}
        </p>
      )}
    </fieldset>
  );
}
