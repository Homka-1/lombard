import { Field, Input } from "../../components/ui/Form";
import { DEMO_CARD, formatCardInput } from "./clientLib";
import styles from "./Client.module.css";

/**
 * Номер банковской карты с маской. Подсказка про тестовую карту мок-банка видна всегда —
 * в том числе когда под полем показана ошибка.
 */
export function CardField({
  value,
  onChange,
  error,
  label = "Номер карты",
}: {
  value: string;
  onChange: (value: string) => void;
  error?: string;
  label?: string;
}) {
  return (
    <div className={styles.cardField}>
      <Field label={label} error={error}>
        {(p) => (
          <Input
            {...p}
            inputMode="numeric"
            autoComplete="cc-number"
            placeholder="0000 0000 0000 0000"
            value={value}
            onChange={(e) => onChange(formatCardInput(e.target.value))}
          />
        )}
      </Field>
      <p className={styles.demoCard}>
        Учебный банк: подойдёт{" "}
        <button type="button" className={styles.inlineLink} onClick={() => onChange(DEMO_CARD)}>
          {DEMO_CARD}
        </button>
      </p>
    </div>
  );
}
