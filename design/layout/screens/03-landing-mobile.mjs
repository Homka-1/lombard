import {
  Artboard, measure, logo, button, field, icon, card, segmented, slider, photo, kzt, kv, hallmark, guilloche,
} from '../kit.mjs';
import { hero, facts, steps, faq } from '../content.mjs';
import { ticket } from './02-landing-desktop.mjs';

export default function landingMobile() {
  const W = 375;
  const X = 16;
  const C = 343;
  const ab = new Artboard('landing-mobile', '3. Лэндинг — mobile 375', W, 5000, 'paper');

  ab.group('header', () => {
    ab.rect(0, 0, W, 60, { fill: 'paper' });
    logo(ab, X, 14);
    icon(ab, 'menu', W - X - 28, 16, 28, 'malachite-900');
    ab.line(0, 60, W, 60, { stroke: 'line' });
  });

  let y = 92;
  ab.group('hero', () => {
    y += ab.text(X, y, hero.title, 'h1', { w: C, fill: 'malachite-950' });
    y += 16;
    y += ab.text(X, y, hero.lead, 'body', { w: C, fill: 'graphite-700' });
    y += 28;
    button(ab, X, y, 'Оценить по фото', { size: 'l', w: C, icon: 'camera' });
    y += 64;
    button(ab, X, y, 'Рассчитать займ', { size: 'l', w: C, variant: 'secondary' });
    y += 52 + 40;
    y += ticket(ab, X, y, C, { compact: true, h: 470, pad: 20 }) + 48;
    facts.forEach(([ic, t, d]) => {
      icon(ab, ic, X, y + 2, 24, 'malachite-700');
      ab.text(X + 40, y, t, 'small-strong');
      ab.text(X + 40, y + 20, d, 'caption', { fill: 'graphite-500' });
      y += 56;
    });
  });

  y += 24;
  ab.group('how', () => {
    const top = y;
    y += 48;
    ab.text(X, y, 'Как это работает', 'h2', { fill: 'malachite-950' });
    y += 68;
    const items = [];
    steps.forEach(([ic, t, d], i) => {
      items.push(y);
      ab.circle(X + 24, y + 24, 24, { fill: i === 0 ? 'malachite-700' : 'malachite-50', stroke: i === 0 ? 'none' : 'malachite-100' });
      icon(ab, ic, X + 13, y + 13, 22, i === 0 ? 'white' : 'malachite-700', 1.75, i === 0 ? 'malachite-700' : 'malachite-50');
      ab.text(X + 64, y, t, 'h4', { w: C - 64 });
      y += 28 + ab.text(X + 64, y + 28, d, 'small', { fill: 'graphite-500', w: C - 64 }) + 28;
    });
    // линия между кружками
    for (let i = 0; i < items.length - 1; i++) ab.line(X + 24, items[i] + 54, X + 24, items[i + 1] - 6, { stroke: 'line-strong', dash: [2, 4] });
    y += 20;
    // фон секции рисуем последним, но ставим первым в группе (под контент)
    const bg = ab.rect(0, top, W, y - top, { fill: 'surface' });
    ab.cur.pop();
    ab.cur.unshift(bg);
  });

  y += 48;
  ab.group('calculator', () => {
    ab.text(X, y, 'Сколько можно получить', 'h2', { fill: 'malachite-950', w: C });
    y += 96;
    ab.text(X, y, 'Что закладываете', 'label', { fill: 'graphite-700' });
    segmented(ab, X, y + 24, ['Золото', 'Часы', 'Техника', 'Серебро'], 0, { h: 40 });
    y += 88;
    field(ab, X, y, 160, { label: 'Проба', value: '585', select: true });
    field(ab, X + 176, y, 167, { label: 'Вес', value: '4,2', suffix: 'г' });
    y += 96;
    ab.text(X, y, 'Срок займа', 'label', { fill: 'graphite-700' });
    ab.text(X + C, y, '30 дней', 'small-strong', { fill: 'malachite-900', align: 'right' });
    slider(ab, X, y + 26, C, (30 - 7) / 53);
    y += 72;
    card(ab, X, y, C, 316, { r: 20, shadow: 'raised' });
    ab.text(X + 20, y + 20, 'Сумма займа', 'small', { fill: 'graphite-500' });
    ab.text(X + 20, y + 42, kzt(95000), 'amount-l', { fill: 'malachite-950' });
    hallmark(ab, X + C - 52, y + 60, '585', { scale: 0.75 });
    let ky = y + 104;
    ky += kv(ab, X + 20, ky, C - 40, 'Ставка', '0,2 % в день');
    ky += kv(ab, X + 20, ky, C - 40, 'Проценты за 30 дней', kzt(5700));
    ky += kv(ab, X + 20, ky, C - 40, 'Вернуть 3 декабря', kzt(100700), { vStyle: 'body-strong', rule: false });
    button(ab, X + 20, ky + 14, 'Оценить по фото', { w: C - 40, icon: 'camera' });
    y += 316 + 56;
  });

  ab.group('accept', () => {
    ab.text(X, y, 'Что принимаем', 'h2', { fill: 'malachite-950' });
    y += 64;
    const items = [
      ['ring', 'Золото и платина', 'До 80 %'],
      ['chain', 'Серебро', 'До 70 %'],
      ['watch', 'Часы', 'До 60 %'],
      ['phone', 'Электроника', 'До 50 %'],
    ];
    const cw = (C - 12) / 2;
    items.forEach(([k, t, l], i) => {
      const cx = X + (i % 2) * (cw + 12);
      const cy = y + Math.floor(i / 2) * 212;
      card(ab, cx, cy, cw, 200, { shadow: false });
      photo(ab, cx + 8, cy + 8, cw - 16, 112, k, { dark: i % 2 === 1, metal: k === 'chain' ? 'line' : 'gold-500' });
      ab.text(cx + 12, cy + 132, t, 'small-strong', { w: cw - 24 });
      ab.text(cx + 12, cy + 172, `${l} от оценки`, 'caption', { fill: 'malachite-700' });
    });
    y += 424 + 48;
  });

  ab.group('faq', () => {
    ab.text(X, y, 'Вопросы', 'h2', { fill: 'malachite-950' });
    y += 64;
    faq.forEach(([q, a], i) => {
      const open = i === 0;
      ab.line(X, y, X + C, y, { stroke: 'line' });
      const qh = ab.text(X, y + 18, q, 'body-strong', { w: C - 40, fill: open ? 'malachite-900' : 'text' });
      icon(ab, open ? 'minus' : 'plus', X + C - 22, y + 18, 22, open ? 'malachite-700' : 'graphite-500', 1.75, 'paper');
      y += qh + 36;
      if (open) y += ab.text(X, y - 8, a, 'small', { w: C, fill: 'graphite-700' }) + 20;
    });
    ab.line(X, y, X + C, y, { stroke: 'line' });
    y += 32;
    ab.text(X, y, 'Звоните с 9:00 до 21:00', 'small', { fill: 'graphite-500' });
    ab.text(X, y + 22, '+7 727 355-08-08', 'amount-m', { fill: 'malachite-900' });
    y += 88;
  });

  ab.group('footer', () => {
    ab.rect(0, y, W, 230, { fill: 'malachite-950' });
    guilloche(ab, 0, y + 6, W, 28, { color: 'gold-300', op: 0.18, lines: 5, periods: 4 });
    logo(ab, X, y + 60, { inverse: true });
    ab.text(X, y + 108, 'Алматы, пр. Абая, 52', 'small', { fill: 'malachite-300' });
    ab.text(X, y + 132, 'help@lombard.example', 'small', { fill: 'malachite-300' });
    ab.line(X, y + 172, X + C, y + 172, { stroke: 'malachite-800' });
    ab.text(X, y + 188, 'Учебный проект. Не является публичной офертой.', 'caption', { fill: 'malachite-300' });
  });
  ab.h = y + 230;
  return ab;
}
