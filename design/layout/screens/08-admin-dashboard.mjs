import { Artboard, button, icon, card, badge, measure, segmented, logo, field, kzt } from '../kit.mjs';

// Столбик с округлённым верхом (4px) и прямым основанием на базовой линии
function bar(ab, x, base, w, h, fill) {
  if (h <= 0) return;
  ab.rect(x, base - h, w, h, { r: Math.min(4, h / 2), fill });
  if (h > 4) ab.rect(x, base - Math.min(4, h / 2), w, Math.min(4, h / 2), { fill });
}

export default function adminDashboard() {
  const W = 1440;
  const SB = 272;
  const ab = new Artboard('admin-dashboard', '8. Администратор — дашборд', W, 1100, 'paper');

  // Боковая навигация
  ab.group('sidebar', () => {
    ab.rect(0, 0, SB, 1100, { fill: 'malachite-950', name: 'sidebar-bg' });
    logo(ab, 24, 26, { inverse: true });
    const nav = [['chart', 'Обзор'], ['list', 'Заявки'], ['card', 'Займы'], ['truck', 'Курьеры'], ['users', 'Пользователи'], ['tag', 'Категории и ставки'], ['scale', 'Цены металлов']];
    nav.forEach(([ic, t], i) => {
      const ny = 104 + i * 48;
      if (i === 0) ab.rect(12, ny - 10, SB - 24, 42, { r: 10, fill: 'malachite-800' });
      icon(ab, ic, 28, ny - 1, 22, i === 0 ? 'gold-300' : 'malachite-300', 1.75, i === 0 ? 'malachite-800' : 'malachite-950');
      ab.text(62, ny, t, i === 0 ? 'small-strong' : 'small', { fill: i === 0 ? 'white' : 'malachite-300' });
    });
    ab.line(24, 1100 - 96, SB - 24, 1100 - 96, { stroke: 'malachite-800' });
    ab.circle(44, 1100 - 52, 18, { fill: 'malachite-800' });
    ab.text(44, 1100 - 62, 'ДН', 'small-strong', { fill: 'gold-300', align: 'center' });
    ab.text(72, 1100 - 70, 'Дана Нурланова', 'small-strong', { fill: 'white' });
    ab.text(72, 1100 - 50, 'Администратор', 'caption', { fill: 'malachite-300' });
  });

  const X = SB + 48;
  const C = W - X - 48;
  let y = 40;
  ab.text(X, y, 'Обзор', 'h1', { fill: 'malachite-950' });
  ab.text(X, y + 60, 'Неделя 28 октября — 3 ноября', 'small', { fill: 'graphite-500' });
  segmented(ab, X + C - measure('СегодняНеделяМесяц', 'small-strong') - 92, y + 10, ['Сегодня', 'Неделя', 'Месяц'], 1);
  y += 112;

  // Ключевые показатели
  const kpis = [
    ['Выдано займов', '18,4 млн ₸', '196 займов', 'up', '+12 % к прошлой неделе'],
    ['Активные займы', '312', 'Портфель 41,7 млн ₸', null, ''],
    ['В очереди у экспертов', '12', 'Среднее ожидание 9 мин', null, ''],
    ['Просрочка', '4,1 %', '13 займов в льготном периоде', 'warn', ''],
  ];
  const kw = (C - 3 * 20) / 4;
  kpis.forEach(([t, v, s, tone, d], i) => {
    const kx = X + i * (kw + 20);
    card(ab, kx, y, kw, 148, { r: 16 });
    ab.text(kx + 24, y + 22, t, 'small', { fill: 'graphite-500' });
    ab.text(kx + 24, y + 48, v, 'amount-l', { fill: tone === 'warn' ? 'danger-700' : 'malachite-950' });
    ab.text(kx + 24, y + 98, s, 'caption', { fill: 'graphite-500' });
    if (d) ab.text(kx + 24, y + 116, d, 'caption', { fill: 'success-700' });
  });
  y += 148 + 24;

  // График выдач по дням (одна серия — без легенды, заголовок называет её)
  const CW = Math.round(C * 0.62);
  ab.group('chart-issued', () => {
    card(ab, X, y, CW, 380, { r: 16 });
    ab.text(X + 28, y + 24, 'Выдано по дням, млн ₸', 'h4');
    const days = [['Пн', 2.1], ['Вт', 2.6], ['Ср', 2.4], ['Чт', 3.1], ['Пт', 3.8], ['Сб', 2.5], ['Вс', 1.9]];
    const px = X + 64;
    const pw = CW - 64 - 28;
    const base = y + 320;
    const ph = 220;
    const max = 4;
    for (let g = 0; g <= 4; g++) {
      const gy = base - (g / 4) * ph;
      ab.line(px, gy, px + pw, gy, { stroke: g === 0 ? 'line-strong' : 'line', sw: 1, dash: g === 0 ? undefined : [2, 4] });
      ab.text(px - 12, gy - 9, String(g), 'caption', { fill: 'graphite-500', align: 'right' });
    }
    const slot = pw / days.length;
    const bw = Math.min(44, slot - 16);
    days.forEach(([d, v], i) => {
      const bx = px + i * slot + (slot - bw) / 2;
      const h = (v / max) * ph;
      bar(ab, bx, base, bw, h, i === 4 ? 'malachite-700' : 'malachite-300');
      ab.text(bx + bw / 2, base + 10, d, 'caption', { fill: 'graphite-500', align: 'center' });
      if (i === 4) {
        ab.text(bx + bw / 2, base - h - 24, '3,8', 'small-strong', { fill: 'text', align: 'center' });
      }
    });
    // тултип при наведении на четверг
    const tx = px + 3 * slot + slot / 2;
    const th = (3.1 / max) * ph;
    ab.rect(tx - 150, base - th - 72, 152, 56, { r: 8, fill: 'malachite-950', shadow: 'raised' });
    ab.text(tx - 138, base - th - 64, 'Четверг, 31 октября', 'caption', { fill: 'malachite-300' });
    ab.text(tx - 138, base - th - 44, '3,1 млн ₸, 33 займа', 'small-strong', { fill: 'white' });
  });

  // Заявки по этапам
  const FX = X + CW + 20;
  const FW = C - CW - 20;
  ab.group('funnel', () => {
    card(ab, FX, y, FW, 380, { r: 16 });
    ab.text(FX + 28, y + 24, 'Заявки по этапам', 'h4');
    const rows = [['Предоценка', 64], ['У эксперта', 12], ['Предложение', 28], ['Курьер', 17], ['Осмотр', 9], ['Деньги выданы', 41]];
    const max = 64;
    const bwMax = FW - 56 - 40;
    rows.forEach(([t, v], i) => {
      const ry = y + 72 + i * 48;
      ab.text(FX + 28, ry, t, 'small', { fill: 'graphite-700' });
      ab.text(FX + FW - 28, ry, String(v), 'small-strong', { fill: 'text', align: 'right' });
      ab.rect(FX + 28, ry + 24, bwMax, 6, { r: 3, fill: 'surface-sunken' });
      ab.rect(FX + 28, ry + 24, (v / max) * bwMax, 6, { r: 3, fill: 'malachite-600' });
    });
  });
  y += 380 + 24;

  // Назначение курьеров + цены металлов
  const AW = Math.round(C * 0.62);
  ab.group('assign', () => {
    const ac = card(ab, X, y, AW, 300, { r: 16 });
    ab.text(X + 28, y + 24, 'Ждут курьера', 'h4');
    ab.text(X + AW - 28, y + 26, 'Назначить автоматически', 'small-strong', { fill: 'malachite-700', align: 'right' });
    const cols = [['Заявка', 0], ['Адрес и время', 120], ['Курьер', 400]];
    const hy = y + 68;
    cols.forEach(([t, dx]) => ab.text(X + 28 + dx, hy, t, 'caption', { fill: 'graphite-500' }));
    ab.line(X + 28, hy + 24, X + AW - 28, hy + 24, { stroke: 'line' });
    const rows = [
      ['10-497', 'пр. Достык, 105', 'Чт, 16:00–18:00', 'Нурлан Б.', '3 выезда'],
      ['10-501', 'ул. Сатпаева, 30А', 'Чт, 10:00–12:00', null, ''],
      ['10-503', 'мкр. Орбита-3, 12', 'Пт, 12:00–14:00', null, ''],
    ];
    rows.forEach(([n, a, t, c, load], i) => {
      const ry = hy + 40 + i * 64;
      ab.text(X + 28, ry + 8, `№ ${n}`, 'small-strong');
      ab.text(X + 148, ry, a, 'small');
      ab.text(X + 148, ry + 20, t, 'caption', { fill: 'graphite-500' });
      if (c) {
        ab.text(X + 428, ry, c, 'small-strong');
        ab.text(X + 428, ry + 20, load, 'caption', { fill: 'graphite-500' });
      } else {
        field(ab, X + 428, ry - 4, AW - 428 - 28, { placeholder: 'Выбрать курьера', select: true, h: 40 });
      }
      if (i < rows.length - 1) ab.line(X + 28, ry + 48, X + AW - 28, ry + 48, { stroke: 'line' });
    });
    ac.h = 316;
  });

  ab.group('metals', () => {
    card(ab, FX, y, FW, 316, { r: 16 });
    ab.text(FX + 28, y + 24, 'Цены металлов, ₸ за грамм', 'h4');
    ab.text(FX + 28, y + 50, 'Обновлено сегодня в 09:00', 'caption', { fill: 'graphite-500' });
    const rows = [['Золото 999', '41 850', '+0,6 %'], ['Золото 585', '24 480', '+0,6 %'], ['Серебро 925', '465', '−0,2 %'], ['Платина 950', '15 320', '+0,1 %']];
    rows.forEach(([m, p, d], i) => {
      const ry = y + 88 + i * 44;
      ab.text(FX + 28, ry, m, 'small');
      ab.text(FX + FW - 110, ry, p, 'small-strong', { align: 'right' });
      ab.text(FX + FW - 28, ry, d, 'caption', { fill: d.startsWith('+') ? 'success-700' : 'danger-700', align: 'right' });
      if (i < rows.length - 1) ab.line(FX + 28, ry + 32, FX + FW - 28, ry + 32, { stroke: 'line' });
    });
    button(ab, FX + 28, y + 256, 'Изменить цены', { size: 's', variant: 'secondary' });
  });

  ab.h = Math.max(1100, y + 300 + 48);
  return ab;
}
