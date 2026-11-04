import { useEffect, useId, useMemo, useRef, useState } from "react";
import styles from "./Uploader.module.css";
import { PHOTO_MAX_BYTES, PHOTO_MAX_COUNT, PHOTO_TYPES, validatePhotos } from "../../lib/photos";
import { Icon } from "./Icon";

interface UploaderProps {
  files: File[];
  onChange: (files: File[]) => void;
  max?: number;
  maxBytes?: number;
  disabled?: boolean;
}

/** Загрузка фото: перетаскивание или выбор файлов, превью, удаление. */
export function Uploader({
  files,
  onChange,
  max = PHOTO_MAX_COUNT,
  maxBytes = PHOTO_MAX_BYTES,
  disabled,
}: UploaderProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const hintId = useId();
  const [over, setOver] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);

  const previews = useMemo(
    () => files.map((f) => ({ file: f, url: URL.createObjectURL(f) })),
    [files],
  );
  useEffect(() => () => previews.forEach((p) => URL.revokeObjectURL(p.url)), [previews]);

  const add = (list: FileList | null) => {
    if (!list) return;
    const { accepted, errors: errs } = validatePhotos(
      Array.from(list),
      files.length,
      max,
      maxBytes,
    );
    setErrors(errs);
    if (accepted.length) onChange([...files, ...accepted]);
  };

  const full = files.length >= max;

  return (
    <div className={styles.uploader}>
      <div
        className={styles.drop}
        data-over={over || undefined}
        data-disabled={disabled || full || undefined}
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled && !full) setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          if (!disabled && !full) add(e.dataTransfer.files);
        }}
      >
        <Icon name="upload" size={28} className={styles.dropIcon} />
        <p className={styles.dropTitle}>Перетащите фото сюда</p>
        <p id={hintId} className={styles.dropHint}>
          JPG, PNG или WebP до {Math.round(maxBytes / 1024 / 1024)} МБ, от 1 до {max} фото. Снимите
          изделие при дневном свете и отдельно — клеймо пробы.
        </p>
        <button
          type="button"
          className={styles.pick}
          onClick={() => inputRef.current?.click()}
          disabled={disabled || full}
          aria-describedby={hintId}
        >
          <Icon name="camera" size={18} strokeWidth={1.9} />
          Выбрать фото
        </button>
        <input
          ref={inputRef}
          type="file"
          accept={PHOTO_TYPES.join(",")}
          multiple
          hidden
          onChange={(e) => {
            add(e.target.files);
            e.target.value = "";
          }}
        />
      </div>

      {errors.length > 0 && (
        <ul className={styles.errors} role="alert">
          {errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}

      {previews.length > 0 && (
        <ul
          className={styles.grid}
          role="list"
          aria-label={`Загружено фото: ${files.length} из ${max}`}
        >
          {previews.map((p, i) => (
            <li key={p.url} className={styles.thumb}>
              <img src={p.url} alt={`Фото ${i + 1}: ${p.file.name}`} />
              <span className={styles.thumbLabel}>Фото {i + 1}</span>
              <button
                type="button"
                className={styles.remove}
                aria-label={`Удалить фото ${i + 1}`}
                onClick={() => onChange(files.filter((f) => f !== p.file))}
                disabled={disabled}
              >
                <Icon name="close" size={16} strokeWidth={2} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
