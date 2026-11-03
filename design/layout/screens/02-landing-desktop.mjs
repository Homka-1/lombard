import {
  Artboard, tokens, measure, logo, button, field, hallmark, guilloche, rosette, icon,
  card, segmented, slider, photo, kzt, kv,
} from '../kit.mjs';
import { hero, facts, steps, faq } from '../content.mjs';

// Залоговый билет — главный образ лэндинга: предварительная оценка в виде
// ценной бумаги с гильошем, клеймом пробы и линией отрыва.
export function ticket(ab, x, y, w, o = {}) {
  const h = o.h || 548;
  const pad = o.pad || 32;
  const iw = w - pad * 2;
  ab.group('ticket', () => {
    // подложка — второй лист под билетом
    ab.rect(x + 18, y + 18, w - 36, h, { r: 24, fill: 'malachite-100' });
    ab.rect(x, y, w, h, { r: 24, fill: 'malachite-900', shadow: 'ticket' });
    guilloche(ab, x + pad, y + 18, iw, 64, { color: 'gold-300', op: 0.3, lines: 7, periods: Math.round(w / 110) });
    if (!o.compact) rosette(ab, x + w - pad - 44, y + 150, 44, { color: 'gold-300', op: 0.4 });
    ab.text(x + pad, y + 98, 'Предварительная оценка', 'small-strong', { fill: 'gold-300' });
    ab.text(x + pad, y + 120, 'Заявка № 10-482, 3 ноября', 'caption', { fill: 'malachite-300' });
    // фото
    const ph = o.compact ? 76 : 96;
    photo(ab, x + pad, y + 156, ph, ph, 'ring', { r: 10 });
    photo(ab, x + pad + ph + 10, y + 156, ph, ph, 'stamp', { r: 10, dark: true });
    ab.text(x + pad + ph * 2 + 26, y + 160, 'Кольцо', 'h4', { fill: 'white' });
    ab.text(x + pad + ph * 2 + 26, y + 186, 'Золото, 4,2 г', 'small', { fill: 'malachite-300' });
    ab.text(x + pad + ph * 2 + 26, y + 206, 'Вставка — фианит', 'small', { fill: 'malachite-300' });
    ab.text(x + pad + ph * 2 + 26, y + 226, 'Фото чёткие', 'small', { fill: 'malachite-300' });
    // сумма
    const ay = y + 156 + ph + 34;
    ab.text(x + pad, ay, 'Рыночная стоимость', 'small', { fill: 'malachite-300' });
    const range = '112 000 – 127 000 ₸';
    const rs = ['amount-xl', 'amount-l', 'amount-m'].find((st) => measure(range, st) <= iw) || 'amount-m';
    ab.text(x + pad, ay + 22, range, rs, { fill: 'white' });
    const by = ay + (o.compact ? 76 : 96);
    ab.text(x + pad, by, 'Уверенность оценки', 'caption', { fill: 'malachite-300' });
    ab.text(x + w - pad, by, '92 %', 'caption', { fill: 'gold-300', align: 'right' });
    ab.rect(x + pad, by + 22, iw, 4, { r: 2, fill: 'malachite-800' });
    ab.rect(x + pad, by + 22, iw * 0.92, 4, { r: 2, fill: 'gold-300' });
    // линия отрыва с вырезами
    const cy = by + 56;
    ab.line(x + 24, cy, x + w - 24, cy, { stroke: 'malachite-600', dash: [3, 5], sw: 1.2 });
    ab.circle(x, cy, 14, { fill: o.bg || 'paper' });
    ab.circle(x + w, cy, 14, { fill: o.bg || 'paper' });
    // условия займа
    ab.text(x + pad, cy + 26, 'Можно получить', 'small', { fill: 'malachite-300' });
    ab.text(x + pad, cy + 46, kzt(95000), 'amount-m', { fill: 'gold-300' });
    ab.text(x + w - pad, cy + 26, 'Вернуть через 30 дней', 'small', { fill: 'malachite-300', align: 'right' });
    ab.text(x + w - pad, cy + 46, kzt(100700), 'amount-m', { fill: 'white', align: 'right' });
  });
  return h;
}

export default function landingDesktop() {
  const W = 1440;
  const X = 120;
  const C = 1200;
  const ab = new Artboard('landing-desktop', '2. Лэндинг — desktop 1440', W, 4000, 'paper');

  // Шапка
  ab.group('header', () => {
    logo(ab, X, 26);
    let nx = 520;
    for (const n of ['Как это работает', 'Калькулятор', 'Что принимаем', 'Вопросы']) {
      ab.text(nx, 30, n, 'small', { fill: 'graphite-700' });
      nx += measure(n, 'small') + 36;
    }
    ab.text(X + C - 222, 30, 'Войти', 'small-strong', { fill: 'malachite-800' });
    button(ab, X + C - 160, 18, 'Оценить изделие', { size: 's', w: 160 });
    ab.line(X, 80, X + C, 80, { stroke: 'line' });
  });

  // Герой
  let y = 136;
  ab.group('hero', () => {
    y += ab.text(X, y, hero.title, 'display', { w: 600, fill: 'malachite-950' });
    y += 28;
    y += ab.text(X, y, hero.lead, 'lead', { w: 520, fill: 'graphite-700' });
    y += 40;
    const b1 = button(ab, X, y, 'Оценить по фото', { size: 'l', icon: 'camera' });
    button(ab, X + b1.w + 16, y, 'Рассчитать займ', { size: 'l', variant: 'secondary' });
    y += 52 + 64;
    ab.line(X, y, X + 600, y, { stroke: 'line' });
    y += 24;
    facts.forEach(([ic, t, d], i) => {
      const fx = X + i * 210;
      icon(ab, ic, fx, y, 24, 'malachite-700');
      ab.text(fx, y + 36, t, 'small-strong', { fill: 'text' });
      ab.text(fx, y + 56, d, 'caption', { fill: 'graphite-500', w: 180 });
    });
    ticket(ab, 760, 128, 520);
  });

  // Как это работает
  y = 820;
  ab.group('how', () => {
    ab.rect(0, y, W, 460, { fill: 'surface' });
    ab.text(X, y + 80, 'Как это работает', 'h1', { fill: 'malachite-950' });
    ab.text(X + 600, y + 92, 'Весь путь занимает от двух часов до одного дня. В ломбард приходить не нужно.', 'body', { fill: 'graphite-500', w: 480 });
    const sy = y + 200;
    const colW = (C - 3 * 24) / 4;
    ab.line(X + 28, sy + 28, X + 3 * (colW + 24) + 28, sy + 28, { stroke: 'line-strong', dash: [2, 4] });
    steps.forEach(([ic, t, d], i) => {
      const sx = X + i * (colW + 24);
      ab.circle(sx + 28, sy + 28, 28, { fill: i === 0 ? 'malachite-700' : 'malachite-50', stroke: i === 0 ? 'none' : 'malachite-100' });
      icon(ab, ic, sx + 16, sy + 16, 24, i === 0 ? 'white' : 'malachite-700', 1.75, i === 0 ? 'malachite-700' : 'malachite-50');
      ab.text(sx, sy + 80, t, 'h4', { fill: 'text', w: colW - 10 });
      ab.text(sx, sy + 112, d, 'small', { fill: 'graphite-500', w: colW - 16 });
    });
  });

  // Калькулятор
  y = 1280 + 120;
  ab.group('calculator', () => {
    ab.text(X, y, 'Сколько можно получить', 'h1', { fill: 'malachite-950' });
    ab.text(X, y + 72, 'Расчёт ориентировочный: точную сумму назовёт эксперт после проверки фото.', 'body', { fill: 'graphite-500', w: 480 });
    let fy = y + 150;
    ab.text(X, fy, 'Что закладываете', 'label', { fill: 'graphite-700' });
    segmented(ab, X, fy + 24, ['Золото', 'Часы', 'Электроника', 'Серебро'], 0, { h: 44 });
    fy += 96;
    field(ab, X, fy, 262, { label: 'Проба', value: '585', select: true });
    field(ab, X + 286, fy, 262, { label: 'Вес', value: '4,2', suffix: 'г' });
    fy += 104;
    ab.text(X, fy, 'Срок займа', 'label', { fill: 'graphite-700' });
    ab.text(X + 548, fy, '30 дней', 'small-strong', { fill: 'malachite-900', align: 'right' });
    slider(ab, X, fy + 28, 548, (30 - 7) / 53);
    ab.text(X, fy + 58, '7 дней', 'caption', { fill: 'graphite-500' });
    ab.text(X + 548, fy + 58, '60 дней', 'caption', { fill: 'graphite-500', align: 'right' });

    // Результат
    const rx = 760;
    const rw = 440 + 120 - 40;
    card(ab, rx, y - 8, rw, 470, { r: 24, shadow: 'raised' });
    ab.text(rx + 40, y + 32, 'Сумма займа', 'small', { fill: 'graphite-500' });
    ab.text(rx + 40, y + 56, kzt(95000), 'amount-xl', { fill: 'malachite-950' });
    hallmark(ab, rx + rw - 80, y + 82, '585', { scale: 0.9 });
    let ky = y + 156;
    ky += kv(ab, rx + 40, ky, rw - 80, 'Оценка изделия', '112 000 – 127 000 ₸');
    ky += kv(ab, rx + 40, ky, rw - 80, 'Доля от оценки', '80 %');
    ky += kv(ab, rx + 40, ky, rw - 80, 'Ставка', '0,2 % в день');
    ky += kv(ab, rx + 40, ky, rw - 80, 'Проценты за 30 дней', kzt(5700));
    ky += kv(ab, rx + 40, ky, rw - 80, 'Вернуть 3 декабря', kzt(100700), { vStyle: 'body-strong', rule: false });
    button(ab, rx + 40, ky + 18, 'Оценить по фото', { size: 'l', w: rw - 80, icon: 'camera' });
  });

  // Что принимаем
  y = 2040;
  ab.group('accept', () => {
    ab.text(X, y, 'Что принимаем', 'h1', { fill: 'malachite-950' });
    const items = [
      ['ring', 'Золото и платина', 'От 375 пробы, лом тоже', '80 %'],
      ['chain', 'Серебро', 'От 800 пробы, столовое серебро', '70 %'],
      ['watch', 'Часы', 'Швейцарские и японские марки', '60 %'],
      ['phone', 'Электроника', 'Смартфоны и ноутбуки до 3 лет', '50 %'],
    ];
    const cw = (C - 3 * 24) / 4;
    items.forEach(([k, t, d, ltv], i) => {
      const cx = X + i * (cw + 24);
      card(ab, cx, y + 88, cw, 330, { shadow: false });
      photo(ab, cx + 12, y + 100, cw - 24, 180, k, { dark: i % 2 === 1, metal: k === 'chain' ? 'line' : 'gold-500' });
      ab.text(cx + 20, y + 300, t, 'h4');
      ab.text(cx + 20, y + 326, d, 'small', { fill: 'graphite-500', w: cw - 40 });
      ab.text(cx + 20, y + 372, `До ${ltv} от оценки`, 'small-strong', { fill: 'malachite-700' });
    });
  });

  // Вопросы
  y = 2560;
  ab.group('faq', () => {
    ab.text(X, y, 'Вопросы', 'h1', { fill: 'malachite-950' });
    ab.text(X, y + 72, 'Не нашли ответ — позвоните, консультация бесплатная.', 'body', { fill: 'graphite-500', w: 320 });
    ab.text(X, y + 136, '+7 727 355-08-08', 'amount-m', { fill: 'malachite-900' });
    ab.text(X, y + 170, 'Ежедневно с 9:00 до 21:00', 'caption', { fill: 'graphite-500' });
    let qy = y;
    const qx = 520;
    const qw = C - (qx - X);
    faq.forEach(([q, a], i) => {
      const open = i === 0;
      ab.line(qx, qy, qx + qw, qy, { stroke: i === 0 ? 'line-strong' : 'line' });
      ab.text(qx, qy + 24, q, 'h4', { fill: open ? 'malachite-900' : 'text' });
      icon(ab, open ? 'minus' : 'plus', qx + qw - 24, qy + 24, 24, open ? 'malachite-700' : 'graphite-500', 1.75, 'paper');
      qy += 72;
      if (open) {
        qy += ab.text(qx, qy - 8, a, 'body', { fill: 'graphite-700', w: 600 }) + 24;
      }
    });
    ab.line(qx, qy, qx + qw, qy, { stroke: 'line' });
    y = qy;
  });

  // Подвал
  y += 120;
  ab.group('footer', () => {
    ab.rect(0, y, W, 300, { fill: 'malachite-950' });
    guilloche(ab, 0, y + 6, W, 36, { color: 'gold-300', op: 0.18, lines: 5, periods: 14 });
    logo(ab, X, y + 80, { inverse: true });
    ab.text(X, y + 130, 'Онлайн-ломбард: оценка по фото, курьер и деньги на карту.', 'small', { fill: 'malachite-300', w: 320 });
    const cols = [
      ['Клиентам', ['Как это работает', 'Калькулятор', 'Тарифы', 'Вопросы']],
      ['Компания', ['О ломбарде', 'Документы', 'Контакты']],
      ['Связаться', ['+7 727 355-08-08', 'help@lombard.example', 'Алматы, пр. Абая, 52']],
    ];
    cols.forEach(([t, links], i) => {
      const cx = 600 + i * 230;
      ab.text(cx, y + 80, t, 'small-strong', { fill: 'white' });
      links.forEach((l, j) => ab.text(cx, y + 112 + j * 28, l, 'small', { fill: 'malachite-300' }));
    });
    ab.line(X, y + 236, X + C, y + 236, { stroke: 'malachite-800' });
    ab.text(X, y + 256, 'Учебный проект. Не является публичной офертой.', 'caption', { fill: 'malachite-300' });
    ab.text(X + C, y + 256, '2026', 'caption', { fill: 'malachite-300', align: 'right' });
  });
  ab.h = y + 300;
  return ab;
}
