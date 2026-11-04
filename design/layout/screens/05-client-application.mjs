import { Artboard, button, icon, card, photo, kv, appHeader, badge, field, hallmark, kzt, measure, wrap } from '../kit.mjs';
import { CLIENT_NAV } from './04-client-wizard.mjs';

// Вертикальный таймлайн статусов заявки
export function timeline(ab, x, y, w, items) {
  // 1-й проход: позиции строк (с учётом переноса примечаний)
  const pts = [];
  let ty = y;
  for (const it of items) {
    pts.push(ty);
    ty += 22 + (it.note ? wrap(it.note, 'caption', w - 36).length * 16 : 0) + 22;
  }
  // линии — первыми, чтобы кружки легли поверх
  for (let i = 0; i < pts.length - 1; i++) {
    const done = items[i + 1].state !== 'todo';
    ab.line(x + 10, pts[i] + 20, x + 10, pts[i + 1], { stroke: done ? 'malachite-700' : 'line', sw: 1.5 });
  }
  items.forEach((it, i) => {
    const py = pts[i];
    const done = it.state === 'done';
    const cur = it.state === 'current';
    ab.circle(x + 10, py + 10, 10, {
      fill: done ? 'malachite-700' : 'surface',
      stroke: done || cur ? 'malachite-700' : 'line-strong', sw: cur ? 2 : 1.5,
    });
    if (cur) ab.circle(x + 10, py + 10, 4, { fill: 'malachite-700' });
    if (done) icon(ab, 'check', x + 3, py + 3, 14, 'white', 2.4);
    ab.text(x + 36, py, it.title, cur ? 'small-strong' : 'small', { fill: it.state === 'todo' ? 'graphite-500' : 'text' });
    if (it.time) ab.text(x + w, py, it.time, 'caption', { fill: 'graphite-500', align: 'right' });
    if (it.note) ab.text(x + 36, py + 22, it.note, 'caption', { fill: 'graphite-500', w: w - 36 });
  });
  return ty - y;
}

export default function clientApplication() {
  const W = 1440;
  const X = 120;
  const ab = new Artboard('client-application', '5. Клиент — карточка заявки', W, 1800, 'paper');
  appHeader(ab, W, { nav: CLIENT_NAV, active: 0, user: 'Айгерим Касымова', initials: 'АК', role: 'Клиент' });

  let y = 108;
  icon(ab, 'arrowLeft', X, y, 20, 'malachite-700');
  ab.text(X + 28, y, 'Мои заявки', 'small-strong', { fill: 'malachite-700' });
  y += 40;
  ab.text(X, y, 'Кольцо с камнем', 'h1', { fill: 'graphite-900' });
  badge(ab, X + measure('Кольцо с камнем', 'h1') + 20, y + 16, 'OFFER_SENT');
  ab.text(X, y + 62, 'Заявка № 10-482 от 3 ноября, золото 585, 4,2 г', 'small', { fill: 'graphite-500' });
  y += 112;

  const MW = 760;
  const RX = X + MW + 40;
  const RW = 1200 - MW - 40;

  // ---------- Оферта ----------
  let oy = y;
  ab.group('offer', () => {
    const oc = card(ab, X, oy, MW, 470);
    const px = X + 40;
    const pw = MW - 80;
    let cy = oy + 40;
    ab.text(px, cy, 'Предложение эксперта', 'h3');
    ab.text(px + pw, cy + 4, 'Действует до 5 ноября, 15:05', 'small', { fill: 'graphite-500', align: 'right' });
    cy += 52;
    ab.text(px, cy, 'Сумма займа', 'small', { fill: 'graphite-500' });
    ab.text(px, cy + 22, kzt(95200), 'amount-xl', { fill: 'graphite-900' });
    hallmark(ab, px + measure(kzt(95200), 'amount-xl') + 56, cy + 54, '585', { scale: 0.8 });
    const gx = px + 400;
    ab.text(gx, cy, 'Вернуть до 3 декабря', 'small', { fill: 'graphite-500' });
    ab.text(gx, cy + 22, kzt(100912), 'amount-l', { fill: 'graphite-700' });
    cy += 108;
    const colW = (pw - 32) / 3;
    [['Оценка эксперта', kzt(119000)], ['Ставка', '0,2 % в день'], ['Срок', '30 дней']].forEach(([k, v], i) => {
      const cx = px + i * (colW + 16);
      ab.rect(cx, cy, colW, 68, { r: 8, stroke: 'line' });
      ab.text(cx + 16, cy + 12, k, 'caption', { fill: 'graphite-500' });
      ab.text(cx + 16, cy + 32, v, 'body-strong');
    });
    cy += 92;
    // комментарий эксперта
    ab.circle(px + 20, cy + 20, 20, { fill: 'surface-sunken' });
    ab.text(px + 20, cy + 10, 'ЕС', 'small-strong', { fill: 'graphite-700', align: 'center' });
    ab.text(px + 56, cy, 'Ерлан Сапаров, эксперт-оценщик', 'small-strong');
    const ch = ab.text(px + 56, cy + 22, 'Клеймо и вес совпадают с описанием. Камень — фианит, на сумму не влияет. Окончательно подтвердим при осмотре.', 'small', { fill: 'graphite-700', w: pw - 56 });
    cy += 22 + ch + 28;
    const b1 = button(ab, px, cy, 'Принять и вызвать курьера', { size: 'l', icon: 'truck' });
    button(ab, px + b1.w + 16, cy, 'Отказаться', { size: 'l', variant: 'ghost' });
    cy += 52 + 40;
    oc.h = cy - oy;
    oy = cy;
  });

  // ---------- Вызов курьера ----------
  oy += 24;
  ab.group('courier-call', () => {
    const cc = card(ab, X, oy, MW, 520, { r: 16 });
    const px = X + 40;
    const pw = MW - 80;
    let cy = oy + 36;
    ab.text(px, cy, 'Вызов курьера', 'h3');
    ab.text(px + pw, cy + 4, 'Бесплатно по Алматы', 'small', { fill: 'graphite-500', align: 'right' });
    cy += 48;
    cy += field(ab, px, cy, pw, { label: 'Адрес', value: 'Алматы, ул. Розыбакиева, 247, кв. 18' }) + 20;
    ab.text(px, cy, 'День', 'label', { fill: 'graphite-700' });
    cy += 26;
    const days = [['Ср, 4 ноября', 'Сегодня'], ['Чт, 5 ноября', 'Завтра'], ['Пт, 6 ноября', ''], ['Сб, 7 ноября', '']];
    const dw = (pw - 36) / 4;
    days.forEach(([d, s], i) => {
      const dx = px + i * (dw + 12);
      const act = i === 1;
      ab.rect(dx, cy, dw, 60, { r: 8, fill: 'surface', stroke: act ? 'malachite-700' : 'line', sw: act ? 1.5 : 1 });
      ab.text(dx + 14, cy + 10, d, 'small-strong', { fill: 'text' });
      if (s) ab.text(dx + 14, cy + 32, s, 'caption', { fill: 'graphite-500' });
    });
    cy += 80;
    ab.text(px, cy, 'Время', 'label', { fill: 'graphite-700' });
    cy += 26;
    const slots = [['10:00–12:00', 'free'], ['12:00–14:00', 'active'], ['14:00–16:00', 'free'], ['16:00–18:00', 'busy'], ['18:00–20:00', 'free']];
    const sw = (pw - 48) / 5;
    slots.forEach(([t, st], i) => {
      const sx = px + i * (sw + 12);
      ab.rect(sx, cy, sw, 44, { r: 8, fill: st === 'active' ? 'malachite-700' : st === 'busy' ? 'surface-sunken' : 'surface', stroke: st === 'free' ? 'line' : 'none' });
      ab.text(sx + sw / 2, cy + 12, st === 'busy' ? 'Занято' : t, 'small-strong', { fill: st === 'active' ? 'white' : st === 'busy' ? 'graphite-400' : 'text', align: 'center' });
    });
    cy += 64;
    field(ab, px, cy, (pw - 16) / 2, { label: 'Телефон для курьера', value: '+7 701 555-24-18' });
    field(ab, px + (pw + 16) / 2, cy, (pw - 16) / 2, { label: 'Комментарий', placeholder: 'Подъезд, домофон, этаж' });
    cy += 88;
    icon(ab, 'shield', px, cy + 12, 22, 'graphite-700', 1.5);
    ab.text(px + 32, cy + 4, 'Изделие застраховано на 119 000 ₸', 'small-strong');
    ab.text(px + 32, cy + 24, 'Курьер упакует его в сейф-пакет при вас', 'caption', { fill: 'graphite-500' });
    button(ab, px + pw - 200, cy + 4, 'Вызвать курьера', { w: 200 });
    cy += 84;
    cc.h = cy - oy;
    oy = cy;
  });

  // ---------- Правая колонка ----------
  let ry = y;
  ab.group('pre-estimate', () => {
    card(ab, RX, ry, RW, 262, { r: 16 });
    ab.text(RX + 28, ry + 28, 'Предварительная оценка', 'h4');
    ab.text(RX + 28, ry + 54, 'По фото и параметрам, 3 ноября', 'caption', { fill: 'graphite-500' });
    ab.text(RX + 28, ry + 84, '112 000 – 127 000 ₸', 'amount-m', { fill: 'graphite-900' });
    ab.text(RX + 28, ry + 128, 'Уверенность', 'caption', { fill: 'graphite-500' });
    ab.text(RX + RW - 28, ry + 128, '92 %', 'caption', { fill: 'graphite-700', align: 'right' });
    ab.rect(RX + 28, ry + 150, RW - 56, 2, { fill: 'line' });
    ab.rect(RX + 28, ry + 150, (RW - 56) * 0.92, 2, { fill: 'malachite-700' });
    const tw = (RW - 56 - 24) / 4;
    ['ring', 'stamp', 'ring', 'ring'].forEach((k, i) => photo(ab, RX + 28 + i * (tw + 8), ry + 174, tw, 60, k, { r: 8 }));
  });
  ry += 286;

  ab.group('timeline', () => {
    const tc = card(ab, RX, ry, RW, 600, { r: 16 });
    ab.text(RX + 28, ry + 28, 'Ход заявки', 'h4');
    const h = timeline(ab, RX + 28, ry + 72, RW - 56, [
      { title: 'Заявка отправлена', time: '3 ноября, 14:40', state: 'done' },
      { title: 'Предоценка готова', time: '14:40', state: 'done' },
      { title: 'Эксперт взял в работу', time: '14:52', state: 'done' },
      { title: 'Предложение', time: '15:05', state: 'current', note: 'Примите или откажитесь до 5 ноября' },
      { title: 'Курьер забирает изделие', state: 'todo' },
      { title: 'Осмотр в ломбарде', state: 'todo' },
      { title: 'Деньги на карту', state: 'todo' },
    ]);
    tc.h = h + 72 + 12;
    ry += tc.h + 24;
  });

  ab.group('help', () => {
    card(ab, RX, ry, RW, 120);
    ab.text(RX + 28, ry + 28, 'Есть вопрос по оценке?', 'h4');
    ab.text(RX + 28, ry + 54, 'Напишите эксперту в чат заявки', 'small', { fill: 'graphite-500' });
    ab.text(RX + 28, ry + 82, 'Открыть чат', 'small-strong', { fill: 'malachite-700' });
  });

  ab.h = Math.max(oy, ry + 120) + 80;
  return ab;
}
