import { useState } from "react";
import styles from "./Admin.module.css";

export interface Bar {
  key: string;
  /** Подпись под столбиком («Пн», «12»); пустая — не показывать. */
  label: string;
  value: number;
  /** Две строки всплывающей подсказки. */
  title: string;
  detail: string;
}

const W = 640;
const H = 260;
const PAD = { top: 24, right: 8, bottom: 32, left: 48 };

/** «Красивый» шаг шкалы: 1, 2, 2,5, 5 × 10ⁿ. */
function niceStep(max: number, ticks = 4): number {
  const raw = max / ticks;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const n = raw / pow;
  const m = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
  return m * pow;
}

/** Столбик со скруглённым верхом (4px), прижатый к оси. */
function barPath(x: number, y: number, w: number, h: number): string {
  const r = Math.min(4, w / 2, h);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

/**
 * Одна серия по дням: столбики одного тона, выделен последний (сегодня) или тот, на
 * который навели. Подсказка — при наведении и фокусе; для скринридеров — таблица.
 */
export function BarChart({
  bars,
  unitLabel,
  formatTick,
  caption,
}: {
  bars: Bar[];
  unitLabel: string;
  formatTick: (v: number) => string;
  caption: string;
}) {
  const [active, setActive] = useState<number | null>(null);
  const max = Math.max(...bars.map((b) => b.value), 0);
  const step = max > 0 ? niceStep(max) : 1;
  const top = max > 0 ? Math.ceil(max / step) * step : 4;
  const ticks = Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step);
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const band = plotW / bars.length;
  const barW = Math.max(4, Math.min(40, band * 0.56));
  const y = (v: number) => PAD.top + plotH - (v / top) * plotH;
  const shown = active ?? bars.length - 1;
  const tip = bars[shown];
  const tipX = PAD.left + band * shown + band / 2;

  return (
    <figure className={styles.chart}>
      <div className={styles.chartArea}>
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className={styles.chartSvg}
          role="img"
          aria-label={caption}
          onMouseLeave={() => setActive(null)}
        >
          {ticks.map((t) => (
            <g key={t}>
              <line
                x1={PAD.left}
                x2={W - PAD.right}
                y1={y(t)}
                y2={y(t)}
                className={t === 0 ? styles.axis : styles.grid}
              />
              <text x={PAD.left - 10} y={y(t) + 4} className={styles.tick} textAnchor="end">
                {formatTick(t)}
              </text>
            </g>
          ))}
          {bars.map((b, i) => {
            const x = PAD.left + band * i + (band - barW) / 2;
            const h = top ? (b.value / top) * plotH : 0;
            return (
              <g key={b.key}>
                {h > 0 && (
                  <path
                    d={barPath(x, y(b.value), barW, h)}
                    className={i === shown ? styles.barActive : styles.bar}
                  />
                )}
                {b.label && (
                  <text
                    x={PAD.left + band * i + band / 2}
                    y={H - 8}
                    className={styles.tick}
                    textAnchor="middle"
                  >
                    {b.label}
                  </text>
                )}
                <rect
                  x={PAD.left + band * i}
                  y={PAD.top}
                  width={band}
                  height={plotH}
                  className={styles.hit}
                  tabIndex={0}
                  aria-label={`${b.title}: ${b.detail}`}
                  onMouseEnter={() => setActive(i)}
                  onFocus={() => setActive(i)}
                  onBlur={() => setActive(null)}
                />
              </g>
            );
          })}
        </svg>
        {tip && max > 0 && (
          <div
            className={styles.tooltip}
            style={{
              left: `${(tipX / W) * 100}%`,
              top: `${(y(tip.value) / H) * 100}%`,
            }}
            data-edge={
              shown > bars.length * 0.75 ? "end" : shown < bars.length * 0.25 ? "start" : undefined
            }
            aria-hidden="true"
          >
            <span>{tip.title}</span>
            <strong>{tip.detail}</strong>
          </div>
        )}
      </div>
      <figcaption className="visually-hidden">{caption}</figcaption>
      <div className="visually-hidden">
        <table>
          <thead>
            <tr>
              <th scope="col">День</th>
              <th scope="col">{unitLabel}</th>
            </tr>
          </thead>
          <tbody>
            {bars.map((b) => (
              <tr key={b.key}>
                <th scope="row">{b.title}</th>
                <td>{b.detail}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </figure>
  );
}
