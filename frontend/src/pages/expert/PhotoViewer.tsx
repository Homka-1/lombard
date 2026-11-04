import { useState } from "react";
import type { KeyboardEvent } from "react";
import type { Photo } from "../../api/types";
import { ItemArt } from "../../components/ItemArt";
import { Icon } from "../../components/ui/Icon";
import { NBSP } from "../../lib/format";
import { isLowQuality, itemKind } from "../client/clientLib";
import styles from "./Expert.module.css";

const ZOOM_MIN = 100;
const ZOOM_MAX = 400;
const ZOOM_STEP = 50;

/** Замечания анализа фото по номеру снимка (1, 2, …) — из `pre_estimate.details.photos`. */
export type PhotoIssues = Record<number, string[]>;

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * Галерея эксперта (артборд 06): большой снимок с увеличением до 400 %, листание
 * стрелками клавиатуры, миниатюры с отметкой слабых снимков.
 * Увеличенный снимок прокручивается внутри рамки — так можно рассмотреть клеймо.
 */
export function PhotoViewer({
  photos,
  categoryCode,
  issues = {},
}: {
  photos: Photo[];
  categoryCode: string;
  issues?: PhotoIssues;
}) {
  const [index, setIndex] = useState(0);
  const [zoom, setZoom] = useState(ZOOM_MIN);

  if (photos.length === 0) {
    return (
      <div className={styles.stage} data-empty>
        <ItemArt kind={itemKind(categoryCode)} className={styles.stageArt} />
        <p className={styles.stageEmpty}>Клиент не приложил фото</p>
      </div>
    );
  }

  const i = Math.min(index, photos.length - 1);
  const photo = photos[i]!;
  const go = (next: number) => {
    setIndex((next + photos.length) % photos.length);
    setZoom(ZOOM_MIN);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "ArrowRight") go(i + 1);
    else if (e.key === "ArrowLeft") go(i - 1);
    else if (e.key === "+" || e.key === "=") setZoom((z) => Math.min(ZOOM_MAX, z + ZOOM_STEP));
    else if (e.key === "-") setZoom((z) => Math.max(ZOOM_MIN, z - ZOOM_STEP));
    else return;
    e.preventDefault();
  };
  const flagged = (p: Photo, n: number) => issues[n]?.length || isLowQuality(p);

  return (
    <section className={styles.gallery} aria-label="Фото изделия">
      <div
        className={styles.stage}
        tabIndex={0}
        onKeyDown={onKey}
        aria-label={`Фото ${i + 1} из ${photos.length}. Стрелки — листать, плюс и минус — масштаб`}
        data-zoomed={zoom > ZOOM_MIN || undefined}
      >
        <img
          key={photo.id}
          src={photo.url}
          alt={`Фото ${i + 1}: ${photo.original_name}`}
          className={styles.stageImg}
          style={{ width: `${zoom}%` }}
        />
      </div>
      <div className={styles.stageBar}>
        <div className={styles.zoomGroup} role="group" aria-label="Масштаб">
          <button
            type="button"
            onClick={() => setZoom((z) => Math.max(ZOOM_MIN, z - ZOOM_STEP))}
            disabled={zoom <= ZOOM_MIN}
            aria-label="Уменьшить"
          >
            <Icon name="minus" size={18} />
          </button>
          <output aria-live="polite">
            {zoom}
            {NBSP}%
          </output>
          <button
            type="button"
            onClick={() => setZoom((z) => Math.min(ZOOM_MAX, z + ZOOM_STEP))}
            disabled={zoom >= ZOOM_MAX}
            aria-label="Увеличить"
          >
            <Icon name="plus" size={18} />
          </button>
        </div>
        {issues[i + 1]?.length ? (
          <p className={styles.stageIssue}>
            <Icon name="alert" size={16} />
            {capitalize(issues[i + 1]!.join(", "))}
          </p>
        ) : null}
        {photos.length > 1 && (
          <div className={styles.zoomGroup} role="group" aria-label="Листать фото">
            <button type="button" onClick={() => go(i - 1)} aria-label="Предыдущее фото">
              <Icon name="chevronLeft" size={18} />
            </button>
            <output>
              {i + 1} из {photos.length}
            </output>
            <button type="button" onClick={() => go(i + 1)} aria-label="Следующее фото">
              <Icon name="chevronRight" size={18} />
            </button>
          </div>
        )}
      </div>
      {photos.length > 1 && (
        <ul className={styles.thumbs} role="list">
          {photos.map((p, n) => (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => go(n)}
                aria-current={n === i || undefined}
                aria-label={`Фото ${n + 1}${flagged(p, n + 1) ? ", есть замечания" : ""}`}
              >
                <img src={p.thumb_url} alt="" />
                {flagged(p, n + 1) ? (
                  <span className={styles.thumbFlag}>
                    {issues[n + 1]?.length ? capitalize(issues[n + 1]![0]!) : "Слабое фото"}
                  </span>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
