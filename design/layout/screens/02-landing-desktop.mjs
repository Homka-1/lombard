import {
  Artboard, tokens, measure, logo, button, field, hallmark, icon,
  card, segmented, slider, photo, kzt, kv,
} from '../kit.mjs';
import { hero, facts, steps, faq } from '../content.mjs';

// Карточка предварительной оценки — главный образ лэндинга.
// Минимализм: белая карточка с обводкой 1px, одна крупная сумма, без декора.
export function ticket(ab, x, y, w, o = {}) {
  const pad = o.pad || 32;
  const iw = w - pad * 2;
  let h = 0;
  ab.group('ticket', () => {
    ab.text(x + pad, y + pad, 'Предварительная оценка', 'small-strong', { fill: 'text' });
    ab.text(x + w - pad, y + pad, 'Заявка № 10-482', 'caption', { fill: 'graphite-500', align: 'right' });
    // фото и параметры
    const ph = o.compact ? 64 : 80;
    const py = y + pad + 40;
    photo(ab, x + pad, py, ph, ph, 'ring');
    ab.text(x + pad + ph + 16, py + 4, 'Кольцо', 'h4', { fill: 'text' });
    ab.text(x + pad + ph + 16, py + 30, 'Золото 585, 4,2 г', 'small', { fill: 'graphite-500' });
    ab.text(x + pad + ph + 16, py + 50, 'Вставка — фианит', 'small', { fill: 'graphite-500' });
    // сумма
    const ay = py + ph + 32;
    ab.line(x + pad, ay - 16, x + w - pad, ay - 16, { stroke: 'line' });
    ab.text(x + pad, ay, 'Рыночная стоимость', 'small', { fill: 'graphite-500' });
    const range = '112 000 – 127 000 ₸';
    const rs = ['amount-xl', 'amount-l', 'amount-m'].find((st) => measure(range, st) <= iw) || 'amount-m';
    ab.text(x + pad, ay + 22, range, rs, { fill: 'graphite-900' });
    const by = ay + (o.compact ? 72 : 96);
    ab.text(x + pad, by, 'Уверенность оценки', 'caption', { fill: 'graphite-500' });
    ab.text(x + w - pad, by, '92 %', 'caption', { fill: 'graphite-700', align: 'right' });
    ab.rect(x + pad, by + 22, iw, 2, { fill: 'line' });
    ab.rect(x + pad, by + 22, iw * 0.92, 2, { fill: 'malachite-700' });
    // условия займа
    const cy = by + 48;
    ab.line(x + pad, cy, x + w - pad, cy, { stroke: 'line' });
    ab.text(x + pad, cy + 20, 'Можно получить', 'small', { fill: 'graphite-500' });
    ab.text(x + pad, cy + 42, kzt(95000), 'amount-m', { fill: 'malachite-700' });
    ab.text(x + w - pad, cy + 20, 'Вернуть через 30 дней', 'small', { fill: 'graphite-500', align: 'right' });
    ab.text(x + w - pad, cy + 42, kzt(100700), 'amount-m', { fill: 'graphite-900', align: 'right' });
    h = cy + 42 + 30 + pad - y;
    // подложку рисуем после измерения, но ставим первой в группе (под контент)
    const bg = ab.rect(x, y, w, h, { r: 12, fill: 'surface', stroke: 'line' });
    ab.cur.pop();
    ab.cur.unshift(bg);
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
    ab.text(X + C - 222, 30, 'Войти', 'small-strong', { fill: 'graphite-900' });
    button(ab, X + C - 160, 18, 'Оценить изделие', { size: 's', w: 160 });
    ab.line(X, 80, X + C, 80, { stroke: 'line' });
  });

  // Герой
  let y = 136;
  ab.group('hero', () => {
    y += ab.text(X, y, hero.title, 'display', { w: 600, fill: 'graphite-900' });
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
      icon(ab, ic, fx, y, 24, 'graphite-700', 1.5, 'paper');
      ab.text(fx, y + 36, t, 'small-strong', { fill: 'text' });
      ab.text(fx, y + 56, d, 'caption', { fill: 'graphite-500', w: 180 });
    });
    ticket(ab, 840, 136, 480);
  });

  // Как это работает
  y = 760;
  ab.group('how', () => {
    ab.line(X, y, X + C, y, { stroke: 'line' });
    ab.text(X, y + 80, 'Как это работает', 'h1', { fill: 'graphite-900' });
    ab.text(X + 600, y + 92, 'Весь путь занимает от двух часов до одного дня. В ломбард приходить не нужно.', 'body', { fill: 'graphite-500', w: 480 });
    const sy = y + 200;
    const colW = (C - 3 * 24) / 4;
    steps.forEach(([, t, d], i) => {
      const sx = X + i * (colW + 24);
      ab.text(sx, sy, `0${i + 1}`, 'small-strong', { fill: 'malachite-700' });
      ab.line(sx, sy + 40, sx + colW, sy + 40, { stroke: 'line' });
      ab.text(sx, sy + 80, t, 'h4', { fill: 'text', w: colW - 10 });
      ab.text(sx, sy + 112, d, 'small', { fill: 'graphite-500', w: colW - 16 });
    });
  });

  // Калькулятор
  y = 1220 + 120;
  ab.group('calculator', () => {
    ab.line(X, y - 120, X + C, y - 120, { stroke: 'line' });
    ab.text(X, y, 'Сколько можно получить', 'h1', { fill: 'graphite-900' });
    ab.text(X, y + 72, 'Расчёт ориентировочный: точную сумму назовёт эксперт после проверки фото.', 'body', { fill: 'graphite-500', w: 480 });
    let fy = y + 150;
    ab.text(X, fy, 'Что закладываете', 'label', { fill: 'graphite-700' });
    segmented(ab, X, fy + 24, ['Золото', 'Часы', 'Электроника', 'Серебро'], 0, { h: 44 });
    fy += 96;
    field(ab, X, fy, 262, { label: 'Проба', value: '585', select: true });
    field(ab, X + 286, fy, 262, { label: 'Вес', value: '4,2', suffix: 'г' });
    fy += 104;
    ab.text(X, fy, 'Срок займа', 'label', { fill: 'graphite-700' });
    ab.text(X + 548, fy, '30 дней', 'small-strong', { fill: 'graphite-900', align: 'right' });
    slider(ab, X, fy + 28, 548, (30 - 7) / 53);
    ab.text(X, fy + 58, '7 дней', 'caption', { fill: 'graphite-500' });
    ab.text(X + 548, fy + 58, '60 дней', 'caption', { fill: 'graphite-500', align: 'right' });

    // Результат
    const rx = 840;
    const rw = 480;
    card(ab, rx, y - 8, rw, 470);
    ab.text(rx + 40, y + 32, 'Сумма займа', 'small', { fill: 'graphite-500' });
    ab.text(rx + 40, y + 56, kzt(95000), 'amount-xl', { fill: 'graphite-900' });
    hallmark(ab, rx + rw - 76, y + 82, '585', { scale: 0.8 });
    let ky = y + 156;
    ky += kv(ab, rx + 40, ky, rw - 80, 'Оценка изделия', '112 000 – 127 000 ₸');
    ky += kv(ab, rx + 40, ky, rw - 80, 'Доля от оценки', '80 %');
    ky += kv(ab, rx + 40, ky, rw - 80, 'Ставка', '0,2 % в день');
    ky += kv(ab, rx + 40, ky, rw - 80, 'Проценты за 30 дней', kzt(5700));
    ky += kv(ab, rx + 40, ky, rw - 80, 'Вернуть 3 декабря', kzt(100700), { vStyle: 'body-strong', rule: false });
    button(ab, rx + 40, ky + 18, 'Оценить по фото', { size: 'l', w: rw - 80, icon: 'camera' });
  });

  // Что принимаем
  y = 1980;
  ab.group('accept', () => {
    ab.text(X, y, 'Что принимаем', 'h1', { fill: 'graphite-900' });
    const items = [
      ['ring', 'Золото и платина', 'От 375 пробы, лом тоже', '80 %'],
      ['chain', 'Серебро', 'От 800 пробы, столовое серебро', '70 %'],
      ['watch', 'Часы', 'Швейцарские и японские марки', '60 %'],
      ['phone', 'Электроника', 'Смартфоны и ноутбуки до 3 лет', '50 %'],
    ];
    const cw = (C - 3 * 24) / 4;
    items.forEach(([k, t, d, ltv], i) => {
      const cx = X + i * (cw + 24);
      card(ab, cx, y + 88, cw, 330);
      photo(ab, cx + 12, y + 100, cw - 24, 180, k, { metal: k === 'chain' ? 'graphite-400' : 'gold-500' });
      ab.text(cx + 20, y + 300, t, 'h4');
      ab.text(cx + 20, y + 326, d, 'small', { fill: 'graphite-500', w: cw - 40 });
      ab.text(cx + 20, y + 372, `До ${ltv} от оценки`, 'small-strong', { fill: 'graphite-900' });
    });
  });

  // Вопросы
  y = 2500;
  ab.group('faq', () => {
    ab.text(X, y, 'Вопросы', 'h1', { fill: 'graphite-900' });
    ab.text(X, y + 72, 'Не нашли ответ — позвоните, консультация бесплатная.', 'body', { fill: 'graphite-500', w: 320 });
    ab.text(X, y + 136, '+7 727 355-08-08', 'amount-m', { fill: 'graphite-900' });
    ab.text(X, y + 170, 'Ежедневно с 9:00 до 21:00', 'caption', { fill: 'graphite-500' });
    let qy = y;
    const qx = 520;
    const qw = C - (qx - X);
    faq.forEach(([q, a], i) => {
      const open = i === 0;
      ab.line(qx, qy, qx + qw, qy, { stroke: 'line' });
      ab.text(qx, qy + 24, q, 'h4', { fill: 'text' });
      icon(ab, open ? 'minus' : 'plus', qx + qw - 24, qy + 24, 24, 'graphite-500', 1.5, 'paper');
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
    ab.line(X, y, X + C, y, { stroke: 'line' });
    logo(ab, X, y + 80);
    ab.text(X, y + 130, 'Онлайн-ломбард: оценка по фото, курьер и деньги на карту.', 'small', { fill: 'graphite-500', w: 320 });
    const cols = [
      ['Клиентам', ['Как это работает', 'Калькулятор', 'Тарифы', 'Вопросы']],
      ['Компания', ['О ломбарде', 'Документы', 'Контакты']],
      ['Связаться', ['+7 727 355-08-08', 'help@lombard.example', 'Алматы, пр. Абая, 52']],
    ];
    cols.forEach(([t, links], i) => {
      const cx = 600 + i * 230;
      ab.text(cx, y + 80, t, 'small-strong', { fill: 'text' });
      links.forEach((l, j) => ab.text(cx, y + 112 + j * 28, l, 'small', { fill: 'graphite-500' }));
    });
    ab.line(X, y + 236, X + C, y + 236, { stroke: 'line' });
    ab.text(X, y + 256, 'Учебный проект. Не является публичной офертой.', 'caption', { fill: 'graphite-500' });
    ab.text(X + C, y + 256, '2026', 'caption', { fill: 'graphite-500', align: 'right' });
  });
  ab.h = y + 300;
  return ab;
}
