import { useMutation } from "@tanstack/react-query";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { applicationsApi } from "../../api/endpoints";
import type { Application, Photo } from "../../api/types";
import { Alert, Spinner } from "../../components/ui/Feedback";
import { Button } from "../../components/ui/Button";
import { Icon } from "../../components/ui/Icon";
import { PHOTO_MAX_BYTES, PHOTO_TYPES, validatePhotos } from "../../lib/photos";
import { isLowQuality } from "./clientLib";
import styles from "./PhotoManager.module.css";

interface Props {
  app: Application;
  onChange: (app: Application) => void;
}

/** Фото заявки на сервере: загрузка сразу при выборе, обложка, удаление, качество снимков. */
export function PhotoManager({ app, onChange }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const hintId = useId();
  const [over, setOver] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [pending, setPending] = useState<File[]>([]);

  const max = app.max_photos;
  const photos = app.photos;
  const total = photos.length + pending.length;
  const full = total >= max;

  const upload = useMutation({
    mutationFn: (files: File[]) => applicationsApi.uploadPhotos(app.id, files),
    onSuccess: onChange,
    onError: (err) => setErrors([err.message]),
    onSettled: () => setPending([]),
  });
  const remove = useMutation({
    mutationFn: (photoId: number) => applicationsApi.deletePhoto(app.id, photoId),
    onSuccess: onChange,
    onError: (err) => setErrors([err.message]),
  });
  const reorder = useMutation({
    mutationFn: (ids: number[]) => applicationsApi.reorderPhotos(app.id, ids),
    onSuccess: onChange,
    onError: (err) => setErrors([err.message]),
  });
  const busy = upload.isPending || remove.isPending || reorder.isPending;

  const add = (list: FileList | null) => {
    if (!list || busy) return;
    const { accepted, errors: errs } = validatePhotos(
      Array.from(list),
      photos.length,
      max,
      PHOTO_MAX_BYTES,
    );
    setErrors(errs);
    if (accepted.length) {
      setPending(accepted);
      upload.mutate(accepted);
    }
  };

  const makeCover = (photo: Photo) =>
    reorder.mutate([photo.id, ...photos.filter((p) => p.id !== photo.id).map((p) => p.id)]);

  const retake = (photo: Photo) => {
    remove.mutate(photo.id, { onSuccess: () => inputRef.current?.click() });
  };

  const weak = photos.filter(isLowQuality);
  const pick = () => inputRef.current?.click();

  return (
    <div className={styles.manager}>
      <div
        className={styles.drop}
        data-over={over || undefined}
        data-disabled={full || undefined}
        onDragOver={(e) => {
          e.preventDefault();
          if (!full) setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          if (!full) add(e.dataTransfer.files);
        }}
      >
        <span className={styles.dropIcon}>
          <Icon name="upload" size={22} />
        </span>
        <p className={styles.dropTitle}>
          {full ? (
            "Загружено максимальное количество фото"
          ) : (
            <>
              Перетащите фото сюда или{" "}
              <button
                type="button"
                className={styles.pickLink}
                onClick={pick}
                aria-describedby={hintId}
              >
                выберите файлы
              </button>
            </>
          )}
        </p>
        <p id={hintId} className={styles.dropHint}>
          JPG, PNG или WebP, до {Math.round(PHOTO_MAX_BYTES / 1024 / 1024)} МБ каждое
        </p>
        <input
          ref={inputRef}
          type="file"
          accept={PHOTO_TYPES.join(",")}
          multiple
          hidden
          data-testid="photo-input"
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

      {total > 0 && (
        <ul className={styles.grid} role="list" aria-label={`Фото: ${photos.length} из ${max}`}>
          {photos.map((p, i) => (
            <PhotoTile
              key={p.id}
              photo={p}
              index={i}
              busy={busy}
              onRemove={() => remove.mutate(p.id)}
              onCover={() => makeCover(p)}
            />
          ))}
          {pending.map((f) => (
            <li key={`${f.name}-${f.size}`} className={styles.tile}>
              <span className={styles.frame} data-pending>
                <Spinner label={`Загружаем ${f.name}`} />
              </span>
              <span className={styles.caption}>Загрузка…</span>
            </li>
          ))}
          {!full && (
            <li className={styles.tile}>
              <button type="button" className={styles.more} onClick={pick} disabled={busy}>
                <Icon name="plus" size={22} />
                Ещё фото
              </button>
            </li>
          )}
        </ul>
      )}

      {weak.map((p) => {
        const n = photos.indexOf(p) + 1;
        return (
          <Alert
            key={p.id}
            tone="warning"
            title={`Фото ${n} получилось нечётким или тёмным`}
            action={
              <Button variant="secondary" size="s" onClick={() => retake(p)} disabled={busy}>
                Переснять
              </Button>
            }
          >
            Переснимите при дневном свете — так эксперт не попросит новое.
          </Alert>
        );
      })}
    </div>
  );
}

function PhotoTile({
  photo,
  index,
  busy,
  onRemove,
  onCover,
}: {
  photo: Photo;
  index: number;
  busy: boolean;
  onRemove: () => void;
  onCover: () => void;
}) {
  const weak = isLowQuality(photo);
  const n = index + 1;
  const [broken, setBroken] = useState(false);
  // подписанная ссылка могла устареть — после обновления данных пробуем снова
  useEffect(() => setBroken(false), [photo.thumb_url]);
  const quality = useMemo(
    () =>
      photo.quality_score === null
        ? null
        : weak
          ? `качество низкое (${photo.quality_score} из 100)`
          : `качество хорошее (${photo.quality_score} из 100)`,
    [photo.quality_score, weak],
  );

  return (
    <li className={styles.tile}>
      <span className={styles.frame} data-weak={weak || undefined}>
        {!broken && <img src={photo.thumb_url} alt={`Фото ${n}`} onError={() => setBroken(true)} />}
        {index === 0 && <span className={styles.cover}>Главное</span>}
        {quality && (
          <span className={styles.quality} data-weak={weak || undefined} title={quality}>
            <Icon name={weak ? "alert" : "check"} size={14} strokeWidth={2.4} />
            <span className="visually-hidden">{quality}</span>
          </span>
        )}
        <button
          type="button"
          className={styles.remove}
          aria-label={`Удалить фото ${n}`}
          onClick={onRemove}
          disabled={busy}
        >
          <Icon name="close" size={14} strokeWidth={2.2} />
        </button>
      </span>
      {index === 0 ? (
        <span className={styles.caption}>Обложка заявки</span>
      ) : (
        <button type="button" className={styles.makeCover} onClick={onCover} disabled={busy}>
          Сделать главным
        </button>
      )}
    </li>
  );
}
