import { Artboard, button, icon, card, badge, measure, guilloche, segmented } from '../kit.mjs';

// Схематичная карта района: кварталы, улицы, маршрут
function miniMap(ab, x, y, w, h) {
  ab.group('map', () => {
    ab.rect(x, y, w, h, { r: 12, fill: 'malachite-50' });
    const blocks = [[8, 10, 70, 40], [88, 10, 90, 40], [188, 10, 70, 40], [268, 10, 40, 40], [8, 62, 50, 60], [68, 62, 110, 26], [68, 98, 110, 24], [188, 62, 120, 60]];
    for (const [bx, by, bw, bh] of blocks) if (bx + bw < w) ab.rect(x + bx, y + by, bw, bh, { r: 4, fill: 'surface', stroke: 'malachite-100' });
    ab.path([[x + 30, y + h - 12], [x + 30, y + 56], [x + 183, y + 56], [x + 183, y + 30], [x + w - 60, y + 30]], { stroke: 'malachite-700', sw: 3 });
    ab.circle(x + 30, y + h - 12, 6, { fill: 'malachite-700', stroke: 'white', sw: 2 });
    ab.circle(x + w - 60, y + 30, 9, { fill: 'gold-500', stroke: 'white', sw: 2 });
    ab.rect(x + w - 108, y + h - 34, 96, 24, { r: 12, fill: 'surface', shadow: 'card' });
    ab.text(x + w - 60, y + h - 31, '2,4 км, 9 мин', 'caption', { fill: 'graphite-700', align: 'center' });
  });
}

export default function courierMobile() {
  const W = 375;
  const X = 16;
  const C = 343;
  const ab = new Artboard('courier-mobile', '7. Курьер — выезды (mobile 375)', W, 1400, 'paper');

  // Шапка смены
  ab.group('shift', () => {
    ab.rect(0, 0, W, 196, { fill: 'malachite-900' });
    guilloche(ab, 0, 172, W, 20, { color: 'gold-300', op: 0.2, lines: 4, periods: 4 });
    ab.text(X, 20, 'Нурлан Бекенов, курьер', 'caption', { fill: 'malachite-300' });
    ab.text(X, 44, 'Сегодня, 4 ноября', 'h2', { fill: 'white' });
    ab.text(X, 100, '2 из 5 выездов выполнено', 'small', { fill: 'malachite-300' });
    ab.rect(X, 130, C, 6, { r: 3, fill: 'malachite-800' });
    ab.rect(X, 130, C * 0.4, 6, { r: 3, fill: 'gold-300' });
    ab.text(X, 152, 'Смена до 20:00', 'caption', { fill: 'malachite-300' });
    ab.text(X + C, 152, 'Следующий — 14:00', 'caption', { fill: 'gold-300', align: 'right' });
  });

  let y = 216;
  segmented(ab, X, y, ['Активные, 3', 'Выполненные, 2'], 0, { h: 40 });
  y += 60;

  // Текущий выезд
  ab.group('current-task', () => {
    const cc = card(ab, X, y, C, 600, { r: 20, shadow: 'raised', stroke: 'malachite-300' });
    const px = X + 20;
    const pw = C - 40;
    let cy = y + 20;
    badge(ab, px, cy, 'COURIER_EN_ROUTE');
    ab.text(px + pw, cy + 4, '12:00–14:00', 'small-strong', { fill: 'malachite-900', align: 'right' });
    cy += 42;
    ab.text(px, cy, 'Забрать изделие', 'h3');
    cy += 34;
    icon(ab, 'pin', px, cy, 20, 'malachite-700');
    ab.text(px + 28, cy - 2, 'ул. Розыбакиева, 247, кв. 18', 'body-strong', { w: pw - 28 });
    ab.text(px + 28, cy + 22, 'Бостандыкский р-н, подъезд 2, домофон 18', 'caption', { fill: 'graphite-500', w: pw - 28 });
    cy += 52;
    miniMap(ab, px, cy, pw, 132);
    cy += 148;
    // клиент
    ab.circle(px + 20, cy + 20, 20, { fill: 'malachite-100' });
    ab.text(px + 20, cy + 10, 'АК', 'small-strong', { fill: 'malachite-900', align: 'center' });
    ab.text(px + 52, cy, 'Айгерим Касымова', 'small-strong');
    ab.text(px + 52, cy + 20, '+7 701 555-24-18', 'caption', { fill: 'graphite-500' });
    ab.rect(px + pw - 44, cy, 44, 40, { r: 10, fill: 'malachite-50', stroke: 'malachite-100' });
    icon(ab, 'phone', px + pw - 34, cy + 8, 24, 'malachite-700', 1.75, 'malachite-50');
    cy += 56;
    // что забрать
    ab.rect(px, cy, pw, 76, { r: 12, fill: 'paper' });
    icon(ab, 'tag', px + 14, cy + 14, 22, 'gold-700', 1.75, 'paper');
    ab.text(px + 46, cy + 12, 'Кольцо, заявка № 10-482', 'small-strong');
    ab.text(px + 46, cy + 32, 'Сейф-пакет СП-20418', 'caption', { fill: 'graphite-500' });
    ab.text(px + 46, cy + 48, 'Страховка 119 000 ₸', 'caption', { fill: 'graphite-500' });
    cy += 92;
    // прогресс выезда
    const st = ['Выехал', 'Забрал', 'Доставил'];
    const sw = pw / 3;
    st.forEach((s, i) => {
      const sx = px + i * sw;
      ab.rect(sx + 2, cy, sw - 4, 4, { r: 2, fill: i === 0 ? 'malachite-700' : 'line' });
      ab.text(sx + 2, cy + 12, s, 'caption', { fill: i === 0 ? 'malachite-900' : 'graphite-500' });
    });
    cy += 44;
    button(ab, px, cy, 'Изделие у меня', { size: 'l', w: pw, icon: 'check' });
    cy += 64;
    ab.text(px + pw / 2, cy, 'Клиент не отвечает', 'small-strong', { fill: 'graphite-500', align: 'center' });
    cy += 40;
    cc.h = cy - y;
    y = cy + 16;
  });

  // Следующие выезды
  const next = [
    ['14:00–16:00', 'Вернуть изделие', 'мкр. Самал-2, 58, кв. 41', 'Часы, займ погашен', 'COURIER_SCHEDULED', 'Вернуть'],
    ['16:00–18:00', 'Забрать изделие', 'пр. Достык, 105, офис 12', 'Серьги, заявка № 10-497', 'COURIER_SCHEDULED', ''],
  ];
  for (const [t, title, addr, what, st] of next) {
    ab.group('task', () => {
      card(ab, X, y, C, 128, { r: 16 });
      ab.text(X + 20, y + 18, t, 'small-strong', { fill: 'malachite-900' });
      badge(ab, X + C - 20, y + 14, st, { align: 'right', label: title === 'Вернуть изделие' ? 'Возврат' : 'Курьер назначен' });
      ab.text(X + 20, y + 46, title, 'body-strong');
      icon(ab, 'pin', X + 20, y + 76, 16, 'graphite-500');
      ab.text(X + 42, y + 74, addr, 'small', { fill: 'graphite-700' });
      ab.text(X + 42, y + 96, what, 'caption', { fill: 'graphite-500' });
      icon(ab, 'chevronRight', X + C - 40, y + 60, 24, 'graphite-400');
    });
    y += 140;
  }

  // Нижняя навигация
  y += 20;
  ab.group('tabbar', () => {
    ab.rect(0, y, W, 76, { fill: 'surface' });
    ab.line(0, y, W, y, { stroke: 'line' });
    const tabs = [['list', 'Выезды', true], ['route', 'Маршрут', false], ['user', 'Профиль', false]];
    tabs.forEach(([ic, t, a], i) => {
      const tx = W / 6 + (i * W) / 3;
      icon(ab, ic, tx - 12, y + 12, 24, a ? 'malachite-700' : 'graphite-400');
      ab.text(tx, y + 40, t, 'caption', { fill: a ? 'malachite-700' : 'graphite-500', align: 'center' });
    });
  });
  ab.h = y + 76;
  return ab;
}
