// Библиотека построения макета.
// Все экраны описываются вызовами этих функций и превращаются в плоский список
// примитивов (rect / ellipse / path / text / group) в абсолютных координатах
// артборда (ось Y вниз, 1px = 1pt). Этот список сериализуется в layout/mockup.json
// и одинаково рисуется двумя рендерерами:
//   - scripts/build-svg.mjs          → previews/svg/*.svg → previews/*.png
//   - illustrator/lombard-mockup.jsx → документ Adobe Illustrator
// Поэтому здесь нельзя использовать ничего, что не умеет один из рендереров:
// градиенты, маски, кривые Безье (только ломаные), размытие и тени.
// Стиль — плоский и минималистичный: глубина передаётся только обводкой 1px.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const opentype = require('opentype.js');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const tokens = JSON.parse(readFileSync(path.join(ROOT, 'tokens.json'), 'utf8'));

// ---------- шрифты и измерение текста ----------
const fontCache = {};
function fontFor(styleName) {
  const st = tokens.typography[styleName];
  if (!st) throw new Error(`Неизвестный текстовый стиль: ${styleName}`);
  const fam = tokens.font[st.font];
  const file = fam.files[String(st.weight)];
  if (!fontCache[file]) fontCache[file] = opentype.loadSync(path.join(ROOT, file));
  return { st, font: fontCache[file] };
}

export function measure(str, styleName) {
  const { st, font } = fontFor(styleName);
  const w = font.getAdvanceWidth(str, st.size, { kerning: true });
  return w + (st.tracking / 1000) * st.size * Math.max(0, [...str].length - 1);
}

// Базовая линия первой строки так, как её считает CSS (half-leading):
// top + (lineHeight - (asc - desc) * size) / 2 + asc * size
export function baselineOffset(styleName) {
  const { st, font } = fontFor(styleName);
  const asc = font.ascender / font.unitsPerEm;
  const desc = -font.descender / font.unitsPerEm;
  return (st.lineHeight - (asc + desc) * st.size) / 2 + asc * st.size;
}

export function wrap(str, styleName, maxW) {
  const out = [];
  for (const para of String(str).split('\n')) {
    const words = para.split(' ');
    let line = '';
    for (const w of words) {
      const probe = line ? line + ' ' + w : w;
      if (line && measure(probe, styleName) > maxW) {
        out.push(line);
        line = w;
      } else line = probe;
    }
    out.push(line);
  }
  return out;
}

// ---------- форматирование ----------
const NBSP = ' ';
export function kzt(n) {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, NBSP) + NBSP + '₸';
}
export function num(n) {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
}

// ---------- геометрия ----------
export function arc(cx, cy, rx, ry, a0, a1, steps = 24) {
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const a = ((a0 + ((a1 - a0) * i) / steps) * Math.PI) / 180;
    pts.push([cx + rx * Math.cos(a), cy + ry * Math.sin(a)]);
  }
  return pts;
}
const r2 = (v) => Math.round(v * 100) / 100;

// ---------- артборд ----------
export class Artboard {
  constructor(id, title, w, h, bg = 'paper') {
    this.id = id;
    this.title = title;
    this.w = w;
    this.h = h;
    this.bg = bg;
    this.root = [];
    this.stack = [this.root];
  }
  get cur() {
    return this.stack[this.stack.length - 1];
  }
  push(item) {
    this.cur.push(item);
    return item;
  }
  group(name, fn) {
    const g = { t: 'group', name, children: [] };
    this.push(g);
    this.stack.push(g.children);
    const res = fn();
    this.stack.pop();
    return res;
  }
  rect(x, y, w, h, o = {}) {
    return this.push({
      t: 'rect', x: r2(x), y: r2(y), w: r2(w), h: r2(h),
      r: o.r || 0, fill: o.fill || 'none', stroke: o.stroke || 'none', sw: o.sw || 1,
      ...(o.op != null ? { op: o.op } : {}), ...(o.dash ? { dash: o.dash } : {}),
      ...(o.name ? { name: o.name } : {}),
    });
  }
  ellipse(cx, cy, rx, ry, o = {}) {
    return this.push({
      t: 'ellipse', x: r2(cx - rx), y: r2(cy - ry), w: r2(rx * 2), h: r2(ry * 2),
      fill: o.fill || 'none', stroke: o.stroke || 'none', sw: o.sw || 1,
      ...(o.op != null ? { op: o.op } : {}),
    });
  }
  circle(cx, cy, r, o) {
    return this.ellipse(cx, cy, r, r, o);
  }
  path(pts, o = {}) {
    return this.push({
      t: 'path', pts: pts.map(([a, b]) => [r2(a), r2(b)]), closed: !!o.closed,
      fill: o.fill || 'none', stroke: o.stroke || 'none', sw: o.sw || 1,
      ...(o.op != null ? { op: o.op } : {}), ...(o.dash ? { dash: o.dash } : {}),
    });
  }
  line(x1, y1, x2, y2, o = {}) {
    return this.path([[x1, y1], [x2, y2]], { stroke: 'line', ...o });
  }
  // Текст: y — верх строки. w — ширина для переноса. align: left|center|right
  // (для center/right x — центр/правый край). Возвращает высоту блока.
  text(x, y, str, style, o = {}) {
    const st = tokens.typography[style];
    const lines = o.w ? wrap(str, style, o.w) : String(str).split('\n');
    this.push({
      t: 'text', x: r2(x), y: r2(y + baselineOffset(style)), lines, style,
      fill: o.fill || 'text', align: o.align || 'left',
      ...(o.op != null ? { op: o.op } : {}),
    });
    return lines.length * st.lineHeight;
  }
}

// ---------- иконки (сетка 24×24, линии 1.75) ----------
const ICONS = {
  camera: () => [
    { pts: [[3, 8], [7, 8], [9, 5], [15, 5], [17, 8], [21, 8], [21, 19], [3, 19]], closed: true },
    { pts: arc(12, 13, 3.6, 3.6, 0, 360, 28), closed: true },
  ],
  upload: () => [
    { pts: [[12, 15], [12, 4]] },
    { pts: [[7.5, 8.5], [12, 4], [16.5, 8.5]] },
    { pts: [[4, 14], [4, 20], [20, 20], [20, 14]] },
  ],
  check: () => [{ pts: [[5, 12.5], [10, 17], [19, 7]] }],
  close: () => [{ pts: [[6, 6], [18, 18]] }, { pts: [[18, 6], [6, 18]] }],
  plus: () => [{ pts: [[12, 5], [12, 19]] }, { pts: [[5, 12], [19, 12]] }],
  minus: () => [{ pts: [[5, 12], [19, 12]] }],
  chevronDown: () => [{ pts: [[6, 9], [12, 15], [18, 9]] }],
  chevronRight: () => [{ pts: [[9, 6], [15, 12], [9, 18]] }],
  chevronLeft: () => [{ pts: [[15, 6], [9, 12], [15, 18]] }],
  clock: () => [{ pts: arc(12, 12, 8.5, 8.5, 0, 360, 36), closed: true }, { pts: [[12, 7], [12, 12], [15.5, 14]] }],
  shield: () => [
    { pts: [[12, 3], [19.5, 6], [19.5, 11], [18, 16], [12, 21], [6, 16], [4.5, 11], [4.5, 6]], closed: true },
    { pts: [[8.5, 12], [11, 14.5], [15.5, 9.5]] },
  ],
  truck: () => [
    { pts: [[2.5, 6], [14, 6], [14, 17], [2.5, 17]], closed: true },
    { pts: [[14, 9.5], [18.5, 9.5], [21.5, 13], [21.5, 17], [14, 17]] },
    { pts: arc(7, 17.5, 1.9, 1.9, 0, 360, 16), closed: true, fill: 'bg' },
    { pts: arc(17.5, 17.5, 1.9, 1.9, 0, 360, 16), closed: true, fill: 'bg' },
  ],
  card: () => [
    { pts: [[3, 6], [21, 6], [21, 18], [3, 18]], closed: true },
    { pts: [[3, 10], [21, 10]] },
    { pts: [[6, 14.5], [10, 14.5]] },
  ],
  pin: () => [
    { pts: [...arc(12, 10, 6.5, 6.5, 150, 390, 30), [12, 21]], closed: true },
    { pts: arc(12, 10, 2.3, 2.3, 0, 360, 16), closed: true },
  ],
  phone: () => [
    { pts: [[7, 3], [17, 3], [17, 21], [7, 21]], closed: true },
    { pts: [[10.5, 18], [13.5, 18]] },
  ],
  user: () => [
    { pts: arc(12, 8.5, 3.8, 3.8, 0, 360, 24), closed: true },
    { pts: [...arc(12, 21, 7.5, 6.5, 180, 360, 20)] },
  ],
  zoom: () => [
    { pts: arc(10.5, 10.5, 6, 6, 0, 360, 30), closed: true },
    { pts: [[15, 15], [20, 20]] },
    { pts: [[8, 10.5], [13, 10.5]] },
    { pts: [[10.5, 8], [10.5, 13]] },
  ],
  calendar: () => [
    { pts: [[4, 6], [20, 6], [20, 20], [4, 20]], closed: true },
    { pts: [[4, 10], [20, 10]] },
    { pts: [[8, 3.5], [8, 7.5]] },
    { pts: [[16, 3.5], [16, 7.5]] },
  ],
  doc: () => [
    { pts: [[6, 3], [14, 3], [18.5, 7.5], [18.5, 21], [6, 21]], closed: true },
    { pts: [[9, 12], [15.5, 12]] },
    { pts: [[9, 15.5], [15.5, 15.5]] },
  ],
  bell: () => [
    { pts: [[6, 17], [6, 11], ...arc(12, 11, 6, 6, 180, 360, 16), [18, 17]] },
    { pts: [[4.5, 17], [19.5, 17]] },
    { pts: [[10, 20], [14, 20]] },
  ],
  scale: () => [
    { pts: [[12, 4], [12, 20]] },
    { pts: [[5, 7], [19, 7]] },
    { pts: [[8, 20], [16, 20]] },
    { pts: [[5, 7], [2.5, 13], [7.5, 13]], closed: true },
    { pts: [[19, 7], [16.5, 13], [21.5, 13]], closed: true },
  ],
  grid: () => [
    { pts: [[4, 4], [10.5, 4], [10.5, 10.5], [4, 10.5]], closed: true },
    { pts: [[13.5, 4], [20, 4], [20, 10.5], [13.5, 10.5]], closed: true },
    { pts: [[4, 13.5], [10.5, 13.5], [10.5, 20], [4, 20]], closed: true },
    { pts: [[13.5, 13.5], [20, 13.5], [20, 20], [13.5, 20]], closed: true },
  ],
  list: () => [{ pts: [[8, 7], [20, 7]] }, { pts: [[8, 12], [20, 12]] }, { pts: [[8, 17], [20, 17]] }, { pts: [[4, 7], [4.5, 7]] }, { pts: [[4, 12], [4.5, 12]] }, { pts: [[4, 17], [4.5, 17]] }],
  chart: () => [{ pts: [[4, 20], [20, 20]] }, { pts: [[7, 16], [7, 11]] }, { pts: [[12, 16], [12, 6]] }, { pts: [[17, 16], [17, 9]] }],
  users: () => [
    { pts: arc(9, 9, 3.3, 3.3, 0, 360, 20), closed: true },
    { pts: arc(9, 20, 6, 5, 180, 360, 16) },
    { pts: arc(16.5, 8.5, 2.6, 2.6, -90, 150, 14) },
    { pts: arc(17, 19.5, 4.5, 4.5, 250, 360, 10) },
  ],
  tag: () => [
    { pts: [[3.5, 12.5], [12, 4], [20, 4], [20, 12], [11.5, 20.5]], closed: true },
    { pts: arc(16, 8, 1.3, 1.3, 0, 360, 12), closed: true },
  ],
  route: () => [
    { pts: arc(6, 6, 2.2, 2.2, 0, 360, 14), closed: true },
    { pts: arc(18.5, 20, 2.2, 2.2, 0, 360, 14), closed: true },
    { pts: [[8.2, 6], [15, 6], ...arc(15, 9.5, 3.5, 3.5, -90, 90, 10), [9, 13], ...arc(9, 16.5, 3.5, 3.5, 270, 90, 10), [16.3, 20]] },
  ],
  sun: () => [{ pts: arc(12, 12, 4, 4, 0, 360, 20), closed: true }, ...[0, 45, 90, 135, 180, 225, 270, 315].map((a) => ({ pts: [[12 + 7 * Math.cos((a * Math.PI) / 180), 12 + 7 * Math.sin((a * Math.PI) / 180)], [12 + 9 * Math.cos((a * Math.PI) / 180), 12 + 9 * Math.sin((a * Math.PI) / 180)]] }))],
  info: () => [{ pts: arc(12, 12, 8.5, 8.5, 0, 360, 36), closed: true }, { pts: [[12, 11], [12, 16.5]] }, { pts: [[12, 7.6], [12, 8]] }],
  alert: () => [{ pts: [[12, 3.5], [21, 19.5], [3, 19.5]], closed: true }, { pts: [[12, 9.5], [12, 14]] }, { pts: [[12, 16.6], [12, 17]] }],
  arrowLeft: () => [{ pts: [[19, 12], [5, 12]] }, { pts: [[11, 6], [5, 12], [11, 18]] }],
  menu: () => [{ pts: [[4, 7], [20, 7]] }, { pts: [[4, 12], [20, 12]] }, { pts: [[4, 17], [20, 17]] }],
  refresh: () => [{ pts: arc(12, 12, 7, 7, -60, 240, 30) }, { pts: [[19.5, 4.5], [19.5, 9], [15, 9]] }],
};

export function icon(ab, name, x, y, size = 24, color = 'text', sw = 1.75, bg = 'surface') {
  const k = size / 24;
  const parts = ICONS[name]();
  ab.group(`icon/${name}`, () => {
    for (const p of parts) {
      ab.path(p.pts.map(([a, b]) => [x + a * k, y + b * k]), {
        closed: !!p.closed, stroke: color, sw: sw * Math.max(0.75, k * 0.9),
        fill: p.fill === 'bg' ? bg : 'none',
      });
    }
  });
}

// ---------- клеймо пробы — фирменный знак оценки ----------
// Вытянутый восьмиугольник с тонким контуром, внутри — число пробы.
export function hallmark(ab, cx, cy, label, o = {}) {
  const s = o.scale || 1;
  const color = o.color || 'gold-500';
  const w = (o.w || 74) * s;
  const h = 40 * s;
  const c = 9 * s;
  const oct = (dx, dy) => [
    [cx - w / 2 + c + dx, cy - h / 2 + dy], [cx + w / 2 - c - dx, cy - h / 2 + dy],
    [cx + w / 2 - dx, cy - h / 2 + c + dy * 0.6], [cx + w / 2 - dx, cy + h / 2 - c - dy * 0.6],
    [cx + w / 2 - c - dx, cy + h / 2 - dy], [cx - w / 2 + c + dx, cy + h / 2 - dy],
    [cx - w / 2 + dx, cy + h / 2 - c - dy * 0.6], [cx - w / 2 + dx, cy - h / 2 + c + dy * 0.6],
  ];
  ab.group(`hallmark/${label}`, () => {
    if (o.fill) ab.path(oct(0, 0), { closed: true, fill: o.fill });
    ab.path(oct(0, 0), { closed: true, stroke: color, sw: 1.25 * s });
    const style = o.style || 'hallmark';
    const st = tokens.typography[style];
    ab.text(cx, cy - st.lineHeight / 2, label, style, { fill: o.textColor || color, align: 'center' });
  });
  return { w, h };
}

// ---------- логотип ----------
export function logo(ab, x, y, o = {}) {
  const inv = !!o.inverse;
  ab.group('logo', () => {
    ab.rect(x, y + 2, 28, 28, { r: 6, fill: inv ? 'white' : 'malachite-700' });
    ab.text(x + 14, y + 2 + (28 - tokens.typography.h4.lineHeight) / 2, 'Л', 'h4', { fill: inv ? 'malachite-700' : 'white', align: 'center' });
    ab.text(x + 40, y + 3, 'Ломбард онлайн', 'logo', { fill: inv ? 'white' : 'graphite-900' });
  });
  return 40 + measure('Ломбард онлайн', 'logo');
}

// ---------- кнопки ----------
const BTN = {
  primary: { fill: 'malachite-700', fg: 'white', stroke: 'none' },
  secondary: { fill: 'surface', fg: 'graphite-900', stroke: 'line-strong' },
  ghost: { fill: 'none', fg: 'malachite-700', stroke: 'none' },
  inverse: { fill: 'white', fg: 'malachite-800', stroke: 'none' },
  danger: { fill: 'surface', fg: 'danger-700', stroke: 'danger-700' },
  disabled: { fill: 'surface-sunken', fg: 'graphite-400', stroke: 'none' },
  focus: { fill: 'malachite-700', fg: 'white', stroke: 'none', ring: true },
};
export function button(ab, x, y, label, o = {}) {
  const v = BTN[o.variant || 'primary'];
  const size = o.size || 'm';
  const h = { s: 36, m: 44, l: 52 }[size];
  const padX = { s: 14, m: 20, l: 26 }[size];
  const iconSize = 18;
  const tw = measure(label, 'button');
  const w = o.w || tw + padX * 2 + (o.icon ? iconSize + 8 : 0);
  ab.group(`button/${label}`, () => {
    if (v.ring) ab.rect(x - 4, y - 4, w + 8, h + 8, { r: 12, stroke: 'malachite-300', sw: 2 });
    ab.rect(x, y, w, h, { r: 8, fill: v.fill, stroke: v.stroke, sw: 1 });
    const st = tokens.typography.button;
    const ty = y + (h - st.lineHeight) / 2;
    if (o.icon) {
      const total = iconSize + 8 + tw;
      const sx = x + (w - total) / 2;
      icon(ab, o.icon, sx, y + (h - iconSize) / 2, iconSize, v.fg, 1.9, v.fill === 'none' ? 'paper' : v.fill);
      ab.text(sx + iconSize + 8, ty, label, 'button', { fill: v.fg });
    } else {
      ab.text(x + w / 2, ty, label, 'button', { fill: v.fg, align: 'center' });
    }
  });
  return { w, h };
}

// ---------- поля ----------
export function field(ab, x, y, w, o = {}) {
  const h = o.h || 44;
  let yy = y;
  ab.group(`field/${o.label || 'input'}`, () => {
    if (o.label) {
      ab.text(x, yy, o.label, 'label', { fill: 'graphite-700' });
      yy += 24;
    }
    const state = o.state || 'default';
    const stroke = state === 'error' ? 'danger-700' : state === 'focus' ? 'malachite-700' : 'line-strong';
    if (state === 'focus') ab.rect(x - 3, yy - 3, w + 6, h + 6, { r: 9, stroke: 'malachite-100', sw: 3 });
    ab.rect(x, yy, w, h, { r: 6, fill: o.disabled ? 'surface-sunken' : 'surface', stroke, sw: state === 'default' ? 1 : 1.5 });
    const st = tokens.typography.body;
    const ty = yy + (h - st.lineHeight) / 2;
    const isPh = !o.value;
    ab.text(x + 14, ty, o.value || o.placeholder || '', 'body', { fill: isPh ? 'graphite-400' : 'text' });
    if (o.suffix) ab.text(x + w - 14, ty, o.suffix, 'body', { fill: 'graphite-500', align: 'right' });
    if (o.select) icon(ab, 'chevronDown', x + w - 34, yy + (h - 20) / 2, 20, 'graphite-500');
    yy += h;
    if (o.hint || o.error) {
      yy += 6;
      ab.text(x, yy, o.error || o.hint, 'caption', { fill: o.error ? 'danger-700' : 'graphite-500', w });
      yy += 16;
    }
  });
  return yy - y;
}

// Сегментированный переключатель
export function segmented(ab, x, y, items, active, o = {}) {
  const h = o.h || 40;
  let cx = x + 4;
  const widths = items.map((t) => measure(t, 'small-strong') + 28);
  const total = widths.reduce((a, b) => a + b, 0) + 8;
  ab.group('segmented', () => {
    ab.rect(x, y, total, h, { r: 8, fill: 'surface-sunken' });
    items.forEach((t, i) => {
      if (i === active) ab.rect(cx, y + 4, widths[i], h - 8, { r: 6, fill: 'surface', stroke: 'line', sw: 1 });
      ab.text(cx + widths[i] / 2, y + (h - 20) / 2, t, 'small-strong', { fill: i === active ? 'graphite-900' : 'graphite-500', align: 'center' });
      cx += widths[i];
    });
  });
  return total;
}

export function slider(ab, x, y, w, t, o = {}) {
  ab.group('slider', () => {
    ab.rect(x, y + 9, w, 4, { r: 2, fill: 'line' });
    ab.rect(x, y + 9, w * t, 4, { r: 2, fill: o.color || 'malachite-700' });
    ab.circle(x + w * t, y + 11, 9, { fill: 'surface', stroke: o.color || 'malachite-700', sw: 2 });
  });
}

export function checkbox(ab, x, y, label, checked, o = {}) {
  ab.group('checkbox', () => {
    ab.rect(x, y + 1, 20, 20, { r: 5, fill: checked ? 'malachite-700' : 'surface', stroke: checked ? 'malachite-700' : 'line-strong', sw: 1.25 });
    if (checked) icon(ab, 'check', x + 2, y + 3, 16, 'white', 2.2);
    ab.text(x + 30, y, label, o.style || 'body', { fill: 'text', w: o.w });
  });
}

// ---------- бейдж статуса ----------
export function badge(ab, x, y, statusKey, o = {}) {
  const s = tokens.status[statusKey];
  const label = o.label || s.label;
  const tone = tokens.tone[s ? s.tone : o.tone];
  const tw = measure(label, 'label');
  const w = tw + 32;
  const h = 26;
  const bx = o.align === 'right' ? x - w : x;
  ab.group(`badge/${statusKey}`, () => {
    ab.rect(bx, y, w, h, { r: 13, fill: tone.bg });
    ab.circle(bx + 13, y + h / 2, 3.5, { fill: tone.dot });
    ab.text(bx + 22, y + (h - 18) / 2, label, 'label', { fill: tone.fg });
  });
  return w;
}

export function chip(ab, x, y, label, o = {}) {
  const tw = measure(label, 'label');
  const w = tw + 24;
  ab.rect(x, y, w, 30, { r: 15, fill: o.active ? 'malachite-900' : 'surface', stroke: o.active ? 'none' : 'line', sw: 1 });
  ab.text(x + w / 2, y + 6, label, 'label', { fill: o.active ? 'white' : 'graphite-700', align: 'center' });
  return w;
}

// ---------- степпер ----------
// steps: массив подписей, current — индекс текущего шага.
export function stepper(ab, x, y, w, steps, current, o = {}) {
  const n = steps.length;
  const gap = w / (n - 1);
  ab.group('stepper', () => {
    ab.line(x, y + 14, x + w, y + 14, { stroke: 'line', sw: 2 });
    ab.line(x, y + 14, x + gap * current, y + 14, { stroke: 'malachite-700', sw: 2 });
    steps.forEach((label, i) => {
      const cx = x + gap * i;
      const done = i < current;
      const active = i === current;
      ab.circle(cx, y + 14, 14, {
        fill: done || active ? 'malachite-700' : 'surface',
        stroke: done || active ? 'malachite-700' : 'line-strong', sw: 1.5,
      });
      if (done) icon(ab, 'check', cx - 8, y + 6, 16, 'white', 2.3);
      else ab.text(cx, y + 4, String(i + 1), 'small-strong', { fill: active ? 'white' : 'graphite-500', align: 'center' });
      const align = o.edgeAlign && i === 0 ? 'left' : o.edgeAlign && i === n - 1 ? 'right' : 'center';
      const lx = align === 'left' ? cx - 14 : align === 'right' ? cx + 14 : cx;
      ab.text(lx, y + 42, label, active ? 'small-strong' : 'small', { fill: active ? 'malachite-900' : done ? 'graphite-700' : 'graphite-500', align });
    });
  });
}

// ---------- карточка ----------
export function card(ab, x, y, w, h, o = {}) {
  return ab.rect(x, y, w, h, {
    r: Math.min(o.r ?? 12, 12), fill: o.fill || 'surface', stroke: o.stroke ?? 'line', sw: 1,
    name: o.name,
  });
}

// ---------- фото изделия (иллюстрация-заглушка) ----------
export function photo(ab, x, y, w, h, kind, o = {}) {
  const dark = false; // минимализм: все фото на одной светлой подложке
  const bg = dark ? 'photo-bg-dark' : 'photo-bg';
  const metal = o.metal || 'gold-500';
  const cx = x + w / 2;
  const cy = y + h / 2;
  const s = Math.min(w, h) / 100;
  ab.group(`photo/${kind}`, () => {
    ab.rect(x, y, w, h, { r: Math.min(o.r ?? 8, 8), fill: bg });
    if (kind === 'ring') {
      ab.ellipse(cx, cy + 6 * s, 24 * s, 24 * s, { stroke: metal, sw: 7 * s });
      ab.ellipse(cx, cy + 6 * s, 24 * s, 24 * s, { stroke: 'gold-300', sw: 1.4 * s, op: 0.9 });
      ab.path([[cx - 9 * s, cy - 22 * s], [cx, cy - 31 * s], [cx + 9 * s, cy - 22 * s], [cx, cy - 15 * s]], { closed: true, fill: 'white', stroke: 'graphite-400', sw: 0.8 * s });
      ab.path([[cx - 9 * s, cy - 22 * s], [cx + 9 * s, cy - 22 * s]], { stroke: 'graphite-400', sw: 0.6 * s });
    } else if (kind === 'watch') {
      ab.rect(cx - 11 * s, y + 4 * s, 22 * s, h - 8 * s, { r: 4 * s, fill: dark ? 'graphite-700' : 'graphite-500' });
      ab.circle(cx, cy, 22 * s, { fill: metal });
      ab.circle(cx, cy, 18 * s, { fill: 'white', stroke: 'gold-700', sw: 0.8 * s });
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        ab.line(cx + Math.cos(a) * 15 * s, cy + Math.sin(a) * 15 * s, cx + Math.cos(a) * 17 * s, cy + Math.sin(a) * 17 * s, { stroke: 'graphite-700', sw: 0.8 * s });
      }
      ab.line(cx, cy, cx + 7 * s, cy - 7 * s, { stroke: 'graphite-900', sw: 1.3 * s });
      ab.line(cx, cy, cx, cy - 13 * s, { stroke: 'graphite-900', sw: 0.9 * s });
    } else if (kind === 'chain') {
      for (let i = 0; i < 9; i++) {
        const t = i / 8;
        const px = x + w * 0.12 + t * w * 0.76;
        const py = cy - 6 * s + Math.sin(t * Math.PI) * 22 * s;
        ab.ellipse(px, py, 6 * s, 3.6 * s, { stroke: metal, sw: 2.2 * s });
      }
      ab.path([[cx - 7 * s, cy + 18 * s], [cx + 7 * s, cy + 18 * s], [cx, cy + 32 * s]], { closed: true, fill: metal });
    } else if (kind === 'earrings') {
      for (const dx of [-16, 16]) {
        ab.circle(cx + dx * s, cy - 14 * s, 4 * s, { stroke: metal, sw: 1.6 * s });
        ab.path([[cx + dx * s, cy - 10 * s], [cx + (dx - 9) * s, cy + 10 * s], [cx + dx * s, cy + 22 * s], [cx + (dx + 9) * s, cy + 10 * s]], { closed: true, fill: 'malachite-600', stroke: metal, sw: 1.4 * s });
      }
    } else if (kind === 'phone') {
      ab.rect(cx - 20 * s, cy - 36 * s, 40 * s, 72 * s, { r: 7 * s, fill: 'graphite-900' });
      ab.rect(cx - 17 * s, cy - 32 * s, 34 * s, 64 * s, { r: 4 * s, fill: 'malachite-700' });
      ab.rect(cx - 5 * s, cy - 30 * s, 10 * s, 2.5 * s, { r: 1.25 * s, fill: 'graphite-900' });
    } else if (kind === 'stamp') {
      // крупный план клейма на шинке кольца
      ab.rect(x + w * 0.08, cy - 18 * s, w * 0.84, 36 * s, { r: 18 * s, fill: metal });
      ab.rect(x + w * 0.08, cy - 18 * s, w * 0.84, 6 * s, { r: 3 * s, fill: 'gold-300', op: 0.7 });
      hallmark(ab, cx, cy, '585', { scale: 0.62 * s * 1.25, color: 'gold-700', style: 'small-strong' });
    } else if (kind === 'coin') {
      ab.circle(cx, cy, 26 * s, { fill: metal });
      ab.circle(cx, cy, 21 * s, { stroke: 'gold-700', sw: 1 * s });
      ab.text(cx, cy - 15, '1', 'amount-m', { fill: 'gold-700', align: 'center' });
    }
    if (o.label) {
      const lw = measure(o.label, 'caption') + 14;
      ab.rect(x + 8, y + h - 30, lw, 22, { r: 4, fill: 'surface' });
      ab.text(x + 15, y + h - 27, o.label, 'caption', { fill: 'graphite-700' });
    }
  });
}

// ---------- шапки ----------
export function appHeader(ab, w, o = {}) {
  ab.group('header', () => {
    ab.rect(0, 0, w, 68, { fill: 'surface' });
    ab.line(0, 68, w, 68, { stroke: 'line' });
    logo(ab, o.x ?? 120, 18);
    let nx = (o.x ?? 120) + 260;
    (o.nav || []).forEach((n, i) => {
      const active = i === (o.active ?? 0);
      ab.text(nx, 24, n, active ? 'small-strong' : 'small', { fill: active ? 'graphite-900' : 'graphite-500' });
      const tw = measure(n, active ? 'small-strong' : 'small');
      if (active) ab.rect(nx, 66, tw, 2, { fill: 'malachite-700' });
      nx += tw + 32;
    });
    const right = w - (o.x ?? 120);
    icon(ab, 'bell', right - 200, 22, 24, 'graphite-700');
    ab.circle(right - 144, 34, 18, { fill: o.avatarFill || 'surface-sunken' });
    ab.text(right - 144, 24, o.initials || 'АК', 'small-strong', { fill: 'graphite-700', align: 'center' });
    ab.text(right - 116, 15, o.user || 'Анна Королёва', 'small-strong', { fill: 'text' });
    ab.text(right - 116, 35, o.role || 'Клиент', 'caption', { fill: 'graphite-500' });
  });
}

export function toast(ab, x, y, w, title, text, o = {}) {
  const tone = tokens.tone[o.tone || 'success'];
  ab.group('toast', () => {
    ab.rect(x, y, w, 72, { r: 12, fill: 'surface', stroke: 'line' });
    icon(ab, o.icon || 'check', x + 18, y + 14, 22, tone.fg, 2);
    ab.text(x + 52, y + 14, title, 'small-strong', { fill: 'text' });
    ab.text(x + 52, y + 36, text, 'small', { fill: 'graphite-500', w: w - 100 });
    icon(ab, 'close', x + w - 34, y + 14, 18, 'graphite-400');
  });
}

// Пара «подпись — значение» в строке таблицы условий
export function kv(ab, x, y, w, k, v, o = {}) {
  ab.text(x, y, k, o.kStyle || 'small', { fill: 'graphite-500' });
  ab.text(x + w, y, v, o.vStyle || 'small-strong', { fill: o.vFill || 'text', align: 'right' });
  if (o.rule !== false) ab.line(x, y + 30, x + w, y + 30, { stroke: 'line' });
  return 40;
}
