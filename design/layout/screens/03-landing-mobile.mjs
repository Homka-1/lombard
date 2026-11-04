import {
  Artboard, measure, logo, button, field, icon, card, segmented, slider, photo, kzt, kv, hallmark,
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
    icon(ab, 'menu', W - X - 28, 16, 28, 'graphite-900', 1.5, 'paper');
    ab.line(0, 60, W, 60, { stroke: 'line' });
  });

  let y = 92;
  ab.group('hero', () => {
    y += ab.text(X, y, hero.title, 'h1', { w: C, fill: 'graphite-900' });
    y += 16;
    y += ab.text(X, y, hero.lead, 'body', { w: C, fill: 'graphite-700' });
    y += 28;
    button(ab, X, y, 'Оценить по фото', { size: 'l', w: C, icon: 'camera' });
    y += 64;
    button(ab, X, y, 'Рассчитать займ', { size: 'l', w: C, variant: 'secondary' });
    y += 52 + 40;
    y += ticket(ab, X, y, C, { compact: true, pad: 20 }) + 40;
    facts.forEach(([ic, t, d]) => {
      icon(ab, ic, X, y + 2, 24, 'graphite-700', 1.5, 'paper');
      ab.text(X + 40, y, t, 'small-strong');
      ab.text(X + 40, y + 20, d, 'caption', { fill: 'graphite-500' });
      y += 56;
    });
  });

  y += 24;
  ab.group('how', () => {
    const top = y;
    y += 48;
    ab.line(X, top, X + C, top, { stroke: 'line' });
    ab.text(X, y, 'Как это работает', 'h2', { fill: 'graphite-900' });
    y += 68;
    steps.forEach(([, t, d], i) => {
      ab.text(X, y + 2, `0${i + 1}`, 'small-strong', { fill: 'malachite-700' });
      ab.text(X + 40, y, t, 'h4', { w: C - 40 });
      y += 28 + ab.text(X + 40, y + 28, d, 'small', { fill: 'graphite-500', w: C - 40 }) + 28;
    });
  });

  y += 48;
  ab.group('calculator', () => {
    ab.line(X, y - 48, X + C, y - 48, { stroke: 'line' });
    ab.text(X, y, 'Сколько можно получить', 'h2', { fill: 'graphite-900', w: C });
    y += 96;
    ab.text(X, y, 'Что закладываете', 'label', { fill: 'graphite-700' });
    segmented(ab, X, y + 24, ['Золото', 'Часы', 'Техника', 'Серебро'], 0, { h: 40 });
    y += 88;
    field(ab, X, y, 160, { label: 'Проба', value: '585', select: true });
    field(ab, X + 176, y, 167, { label: 'Вес', value: '4,2', suffix: 'г' });
    y += 96;
    ab.text(X, y, 'Срок займа', 'label', { fill: 'graphite-700' });
    ab.text(X + C, y, '30 дней', 'small-strong', { fill: 'graphite-900', align: 'right' });
    slider(ab, X, y + 26, C, (30 - 7) / 53);
    y += 72;
    card(ab, X, y, C, 316);
    ab.text(X + 20, y + 20, 'Сумма займа', 'small', { fill: 'graphite-500' });
    ab.text(X + 20, y + 42, kzt(95000), 'amount-l', { fill: 'graphite-900' });
    hallmark(ab, X + C - 50, y + 60, '585', { scale: 0.7 });
    let ky = y + 104;
    ky += kv(ab, X + 20, ky, C - 40, 'Ставка', '0,2 % в день');
    ky += kv(ab, X + 20, ky, C - 40, 'Проценты за 30 дней', kzt(5700));
    ky += kv(ab, X + 20, ky, C - 40, 'Вернуть 3 декабря', kzt(100700), { vStyle: 'body-strong', rule: false });
    button(ab, X + 20, ky + 14, 'Оценить по фото', { w: C - 40, icon: 'camera' });
    y += 316 + 56;
  });

  ab.group('accept', () => {
    ab.text(X, y, 'Что принимаем', 'h2', { fill: 'graphite-900' });
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
      card(ab, cx, cy, cw, 200);
      photo(ab, cx + 8, cy + 8, cw - 16, 112, k, { metal: k === 'chain' ? 'graphite-400' : 'gold-500' });
      ab.text(cx + 12, cy + 132, t, 'small-strong', { w: cw - 24 });
      ab.text(cx + 12, cy + 172, `${l} от оценки`, 'caption', { fill: 'graphite-700' });
    });
    y += 424 + 48;
  });

  ab.group('faq', () => {
    ab.text(X, y, 'Вопросы', 'h2', { fill: 'graphite-900' });
    y += 64;
    faq.forEach(([q, a], i) => {
      const open = i === 0;
      ab.line(X, y, X + C, y, { stroke: 'line' });
      const qh = ab.text(X, y + 18, q, 'body-strong', { w: C - 40, fill: 'text' });
      icon(ab, open ? 'minus' : 'plus', X + C - 22, y + 18, 22, 'graphite-500', 1.5, 'paper');
      y += qh + 36;
      if (open) y += ab.text(X, y - 8, a, 'small', { w: C, fill: 'graphite-700' }) + 20;
    });
    ab.line(X, y, X + C, y, { stroke: 'line' });
    y += 32;
    ab.text(X, y, 'Звоните с 9:00 до 21:00', 'small', { fill: 'graphite-500' });
    ab.text(X, y + 22, '+7 727 355-08-08', 'amount-m', { fill: 'graphite-900' });
    y += 88;
  });

  ab.group('footer', () => {
    ab.line(X, y, X + C, y, { stroke: 'line' });
    logo(ab, X, y + 40);
    ab.text(X, y + 88, 'Алматы, пр. Абая, 52', 'small', { fill: 'graphite-500' });
    ab.text(X, y + 112, 'help@lombard.example', 'small', { fill: 'graphite-500' });
    ab.line(X, y + 152, X + C, y + 152, { stroke: 'line' });
    ab.text(X, y + 168, 'Учебный проект. Не является публичной офертой.', 'caption', { fill: 'graphite-500' });
  });
  ab.h = y + 210;
  return ab;
}
