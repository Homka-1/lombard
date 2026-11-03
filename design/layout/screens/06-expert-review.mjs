import { Artboard, button, icon, card, photo, kv, appHeader, badge, field, hallmark, kzt, measure, segmented, slider, guilloche } from '../kit.mjs';

export default function expertReview() {
  const W = 1440;
  const X = 120;
  const ab = new Artboard('expert-review', '6. Эксперт — экран оценки', W, 1300, 'paper');
  appHeader(ab, W, { nav: ['Очередь', 'Осмотр', 'История'], active: 0, user: 'Ерлан Сапаров', initials: 'ЕС', role: 'Эксперт' });

  let y = 108;
  icon(ab, 'arrowLeft', X, y, 20, 'malachite-700');
  ab.text(X + 28, y, 'Очередь, 12 заявок', 'small-strong', { fill: 'malachite-700' });
  y += 40;
  ab.text(X, y, 'Заявка № 10-482', 'h1', { fill: 'malachite-950' });
  const tw = measure('Заявка № 10-482', 'h1');
  badge(ab, X + tw + 20, y + 16, 'UNDER_REVIEW');
  ab.text(X, y + 62, 'Кольцо с камнем, клиент Айгерим К., отправлена 3 ноября в 14:40', 'small', { fill: 'graphite-500' });
  // таймер SLA
  ab.rect(X + 1200 - 230, y + 6, 230, 52, { r: 12, fill: 'warning-100' });
  icon(ab, 'clock', X + 1200 - 214, y + 20, 24, 'warning-700', 1.75, 'warning-100');
  ab.text(X + 1200 - 180, y + 10, 'Ответить за 8 мин', 'small-strong', { fill: 'warning-700' });
  ab.text(X + 1200 - 180, y + 30, 'Норматив — 15 минут', 'caption', { fill: 'graphite-700' });
  y += 112;

  // ---------- Галерея ----------
  const GW = 700;
  ab.group('gallery', () => {
    const gh = 470;
    photo(ab, X, y, GW, gh, 'ring', { dark: true, r: 16 });
    // лупа — фирменный жест эксперта: увеличенное клеймо
    const lx = X + GW - 170;
    const ly = y + 150;
    ab.circle(lx, ly, 104, { fill: 'gold-500', shadow: 'raised' });
    ab.circle(lx, ly, 96, { fill: 'gold-300' });
    ab.rect(lx - 96, ly - 34, 192, 68, { fill: 'gold-500' });
    ab.rect(lx - 96, ly - 34, 192, 10, { fill: 'gold-300', op: 0.8 });
    hallmark(ab, lx, ly, '585', { scale: 1.3, color: 'gold-700', style: 'h2' });
    ab.circle(lx, ly, 96, { stroke: 'malachite-950', sw: 2 });
    ab.line(lx + 70, ly + 70, lx + 120, ly + 120, { stroke: 'malachite-950', sw: 10 });
    ab.text(lx, ly + 112, 'Лупа ×4', 'caption', { fill: 'white', align: 'center' });
    // зум-контролы
    ab.rect(X + 16, y + gh - 60, 172, 44, { r: 10, fill: 'malachite-950', op: 0.8 });
    icon(ab, 'minus', X + 28, y + gh - 50, 24, 'white', 1.75, 'malachite-950');
    ab.text(X + 102, y + gh - 48, '200 %', 'small-strong', { fill: 'white', align: 'center' });
    icon(ab, 'plus', X + 152, y + gh - 50, 24, 'white', 1.75, 'malachite-950');
    ab.rect(X + GW - 120, y + gh - 60, 104, 44, { r: 10, fill: 'malachite-950', op: 0.8 });
    ab.text(X + GW - 68, y + gh - 48, '1 из 4', 'small-strong', { fill: 'white', align: 'center' });
    // миниатюры
    const ty = y + gh + 16;
    const tw2 = (GW - 3 * 12) / 4;
    ['ring', 'stamp', 'ring', 'ring'].forEach((k, i) => {
      photo(ab, X + i * (tw2 + 12), ty, tw2, 96, k, { dark: i !== 2, r: 10 });
      if (i === 0) ab.rect(X - 2, ty - 2, tw2 + 4, 100, { r: 12, stroke: 'gold-500', sw: 2.5 });
      if (i === 3) {
        ab.rect(X + i * (tw2 + 12) + 8, ty + 8, 108, 22, { r: 11, fill: 'warning-100' });
        ab.text(X + i * (tw2 + 12) + 62, ty + 10, 'Темнее нормы', 'caption', { fill: 'warning-700', align: 'center' });
      }
    });
  });

  // ---------- Данные клиента и авто-оценка ----------
  let ly = y + 470 + 16 + 96 + 32;
  ab.group('client-data', () => {
    const cw = (GW - 24) / 2;
    const c1 = card(ab, X, ly, cw, 300, { r: 16 });
    ab.text(X + 24, ly + 24, 'Со слов клиента', 'h4');
    let ky = ly + 64;
    for (const [k, v] of [['Изделие', 'Кольцо'], ['Металл', 'Золото'], ['Проба', '585'], ['Вес', '4,2 г'], ['Вставка', 'Фианит'], ['Состояние', 'Потёртости']]) {
      ky += kv(ab, X + 24, ky, cw - 48, k, v, { rule: k !== 'Состояние' }) - 4;
    }
    c1.h = ky - ly + 4;
    const ax = X + cw + 24;
    card(ab, ax, ly, cw, c1.h, { r: 16, fill: 'malachite-50', stroke: 'malachite-100', shadow: false });
    ab.text(ax + 24, ly + 24, 'Авто-оценка', 'h4');
    ab.text(ax + 24, ly + 50, 'По формуле и анализу фото', 'caption', { fill: 'graphite-500' });
    ab.text(ax + 24, ly + 80, '112 000 – 127 000 ₸', 'amount-m', { fill: 'malachite-950' });
    ab.text(ax + 24, ly + 124, 'Уверенность 92 %', 'caption', { fill: 'graphite-700' });
    ab.rect(ax + 24, ly + 146, cw - 48, 4, { r: 2, fill: 'malachite-100' });
    ab.rect(ax + 24, ly + 146, (cw - 48) * 0.92, 4, { r: 2, fill: 'malachite-700' });
    const checks = [['check', 'success-700', 'Резкость в норме, 4 фото'], ['check', 'success-700', 'Клеймо найдено'], ['alert', 'warning-700', 'Фото 4 темнее нормы']];
    checks.forEach(([ic, c, t], i) => {
      icon(ab, ic, ax + 24, ly + 172 + i * 30, 18, c, 2, 'malachite-50');
      ab.text(ax + 50, ly + 170 + i * 30, t, 'small', { fill: 'graphite-700' });
    });
    ly += c1.h;
  });

  // ---------- Форма оценки ----------
  const FX = X + GW + 40;
  const FW = 1200 - GW - 40;
  let fy = y;
  ab.group('appraisal-form', () => {
    const fc = card(ab, FX, fy, FW, 900, { r: 16, shadow: 'raised' });
    const px = FX + 32;
    const pw = FW - 64;
    let cy = fy + 32;
    ab.text(px, cy, 'Экспертная оценка', 'h3');
    cy += 48;
    ab.text(px, cy, 'Проба подтверждается по фото', 'label', { fill: 'graphite-700' });
    segmented(ab, px, cy + 24, ['Да', 'Нет', 'Нужно фото'], 0, { h: 40 });
    cy += 88;
    cy += field(ab, px, cy, pw, { label: 'Рыночная стоимость', value: '119 000', suffix: '₸', state: 'focus', hint: 'Авто-оценка: 112 000 – 127 000 ₸' }) + 20;
    const hw = (pw - 16) / 2;
    field(ab, px, cy, hw, { label: 'Доля от оценки', value: '80', suffix: '%', hint: 'Золото: до 80 %' });
    field(ab, px + hw + 16, cy, hw, { label: 'Ставка', value: '0,2', suffix: '% в день' });
    cy += 110;
    ab.text(px, cy, 'Срок займа', 'label', { fill: 'graphite-700' });
    ab.text(px + pw, cy, '30 дней', 'small-strong', { fill: 'malachite-900', align: 'right' });
    slider(ab, px, cy + 26, pw, (30 - 7) / 53);
    cy += 68;

    // живой калькулятор
    ab.rect(px, cy, pw, 172, { r: 14, fill: 'malachite-900' });
    guilloche(ab, px + pw - 170, cy + 14, 150, 52, { color: 'gold-300', op: 0.25, lines: 5, periods: 2 });
    ab.text(px + 24, cy + 20, 'Клиент получит', 'small', { fill: 'malachite-300' });
    ab.text(px + 24, cy + 42, kzt(95200), 'amount-l', { fill: 'white' });
    let ky = cy + 104;
    for (const [k, v] of [['Проценты за 30 дней', kzt(5712)], ['Вернуть до 3 декабря', kzt(100912)]]) {
      ab.text(px + 24, ky, k, 'small', { fill: 'malachite-300' });
      ab.text(px + pw - 24, ky, v, 'small-strong', { fill: 'white', align: 'right' });
      ky += 32;
    }
    ab.line(px + 24, cy + 132, px + pw - 24, cy + 132, { stroke: 'malachite-700' });
    cy += 172 + 24;
    ab.text(px, cy, 'Комментарий клиенту', 'label', { fill: 'graphite-700' });
    ab.rect(px, cy + 24, pw, 84, { r: 6, fill: 'surface', stroke: 'line-strong' });
    ab.text(px + 14, cy + 36, 'Клеймо и вес совпадают с описанием. Камень — фианит, на сумму не влияет.', 'body', { w: pw - 28 });
    cy += 132;
    button(ab, px, cy, 'Отправить предложение', { size: 'l', w: pw });
    cy += 64;
    const bw = (pw - 12) / 2;
    button(ab, px, cy, 'Запросить фото', { variant: 'secondary', w: bw, icon: 'camera' });
    button(ab, px + bw + 12, cy, 'Отклонить заявку', { variant: 'danger', w: bw });
    cy += 44 + 32;
    fc.h = cy - fy;
    fy = cy;
  });

  ab.h = Math.max(ly, fy) + 80;
  return ab;
}
