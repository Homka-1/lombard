import { Artboard, button, icon, card, stepper, photo, kv, appHeader, measure } from '../kit.mjs';

export const CLIENT_NAV = ['Мои заявки', 'Займы', 'Документы'];

export default function clientWizard() {
  const W = 1440;
  const X = 120;
  const ab = new Artboard('client-wizard', '4. Клиент — мастер заявки, шаг «Фото»', W, 1160, 'paper');
  appHeader(ab, W, { nav: CLIENT_NAV, active: 0, user: 'Айгерим Касымова', initials: 'АК', role: 'Клиент' });

  let y = 108;
  icon(ab, 'arrowLeft', X, y, 20, 'malachite-700');
  ab.text(X + 28, y, 'Мои заявки', 'small-strong', { fill: 'malachite-700' });
  y += 40;
  ab.text(X, y, 'Новая заявка', 'h1', { fill: 'malachite-950' });
  ab.text(X + 1200, y + 18, 'Черновик сохранён в 14:32', 'caption', { fill: 'graphite-500', align: 'right' });
  y += 92;
  stepper(ab, X + 14, y, 740, ['Изделие', 'Параметры', 'Фото', 'Проверка'], 2, { edgeAlign: true });
  y += 96;

  // Основная колонка
  const MW = 760;
  const mainCard = card(ab, X, y, MW, 760, { r: 16 });
  const px = X + 32;
  const pw = MW - 64;
  let cy = y + 32;
  ab.text(px, cy, 'Фотографии изделия', 'h3');
  ab.text(px + pw, cy + 4, '4 из 6', 'small-strong', { fill: 'graphite-500', align: 'right' });
  cy += 36;
  cy += ab.text(px, cy, 'Загрузите от 1 до 6 снимков. Чем лучше видны клеймо и камни, тем точнее предварительная оценка.', 'body', { fill: 'graphite-500', w: 560 });
  cy += 24;

  // Зона загрузки
  ab.group('dropzone', () => {
    ab.rect(px, cy, pw, 148, { r: 14, fill: 'malachite-50', stroke: 'malachite-600', sw: 1.5, dash: [6, 6] });
    ab.circle(px + pw / 2, cy + 44, 24, { fill: 'surface', stroke: 'malachite-100' });
    icon(ab, 'upload', px + pw / 2 - 12, cy + 32, 24, 'malachite-700', 1.75, 'surface');
    const t1 = 'Перетащите фото сюда или ';
    const t2 = 'выберите файлы';
    const tw = measure(t1, 'body') + measure(t2, 'body-strong');
    ab.text(px + pw / 2 - tw / 2, cy + 82, t1, 'body', { fill: 'graphite-700' });
    ab.text(px + pw / 2 - tw / 2 + measure(t1, 'body'), cy + 82, t2, 'body-strong', { fill: 'malachite-700' });
    ab.text(px + pw / 2, cy + 110, 'JPG, PNG или HEIC, до 10 МБ каждое', 'caption', { fill: 'graphite-500', align: 'center' });
  });
  cy += 172;

  // Миниатюры
  const tw = (pw - 5 * 12) / 6;
  const th = tw;
  const thumbs = [
    { kind: 'ring', state: 'ok', label: 'Общий вид' },
    { kind: 'stamp', state: 'ok', label: 'Клеймо', dark: true },
    { kind: 'ring', state: 'ok', label: 'Сбоку' },
    { kind: 'ring', state: 'dark', label: 'Вставка', dark: true },
    { kind: 'ring', state: 'loading' },
    { state: 'empty' },
  ];
  ab.group('thumbs', () => {
    thumbs.forEach((t, i) => {
      const tx = px + i * (tw + 12);
      if (t.state === 'empty') {
        ab.rect(tx, cy, tw, th, { r: 10, fill: 'surface', stroke: 'line-strong', dash: [4, 4] });
        icon(ab, 'plus', tx + tw / 2 - 12, cy + th / 2 - 22, 24, 'graphite-500');
        ab.text(tx + tw / 2, cy + th / 2 + 8, 'Ещё фото', 'caption', { fill: 'graphite-500', align: 'center' });
        return;
      }
      photo(ab, tx, cy, tw, th, t.kind, { dark: t.dark, r: 10 });
      if (t.state === 'dark') ab.rect(tx, cy, tw, th, { r: 10, fill: 'malachite-950', op: 0.45 });
      if (t.state === 'loading') {
        ab.rect(tx, cy, tw, th, { r: 10, fill: 'surface', op: 0.7 });
        ab.rect(tx + 12, cy + th / 2 - 2, tw - 24, 4, { r: 2, fill: 'line' });
        ab.rect(tx + 12, cy + th / 2 - 2, (tw - 24) * 0.62, 4, { r: 2, fill: 'malachite-700' });
        ab.text(tx + tw / 2, cy + th / 2 + 10, '62 %', 'caption', { fill: 'graphite-700', align: 'center' });
      }
      if (t.state === 'ok') {
        ab.circle(tx + tw - 14, cy + 14, 10, { fill: 'success-700' });
        icon(ab, 'check', tx + tw - 21, cy + 7, 14, 'white', 2.4);
      }
      if (t.state === 'dark') {
        ab.circle(tx + tw - 14, cy + 14, 10, { fill: 'warning-700' });
        ab.text(tx + tw - 14, cy + 6, '!', 'small-strong', { fill: 'white', align: 'center' });
      }
      if (i === 0) {
        ab.rect(tx + 8, cy + th - 26, 58, 18, { r: 9, fill: 'malachite-900' });
        ab.text(tx + 37, cy + th - 25, 'Главное', 'caption', { fill: 'white', align: 'center' });
      }
      if (t.label) ab.text(tx, cy + th + 8, t.label, 'caption', { fill: t.state === 'dark' ? 'warning-700' : 'graphite-700' });
    });
  });
  cy += th + 40;

  // Предупреждение о качестве
  ab.group('quality-warning', () => {
    ab.rect(px, cy, pw, 64, { r: 10, fill: 'warning-100' });
    icon(ab, 'alert', px + 16, cy + 20, 22, 'warning-700', 1.75, 'warning-100');
    ab.text(px + 50, cy + 12, 'Фото «Вставка» слишком тёмное', 'small-strong', { fill: 'warning-700' });
    ab.text(px + 50, cy + 32, 'Переснимите при дневном свете — так эксперт не попросит новое.', 'small', { fill: 'graphite-700' });
    button(ab, px + pw - 142, cy + 14, 'Переснять', { size: 's', variant: 'secondary', w: 126 });
  });
  cy += 88;

  // Советы
  ab.text(px, cy, 'Как снять, чтобы оценка была точнее', 'h4');
  cy += 36;
  const tips = [
    ['sun', 'Дневной свет', 'Без вспышки и резких теней'],
    ['zoom', 'Клеймо крупно', 'Проба должна читаться'],
    ['grid', 'Однотонный фон', 'Белый лист или ткань'],
  ];
  tips.forEach(([ic, t, d], i) => {
    const tx = px + i * (pw / 3);
    icon(ab, ic, tx, cy + 2, 22, 'malachite-700');
    ab.text(tx + 34, cy, t, 'small-strong');
    ab.text(tx + 34, cy + 20, d, 'caption', { fill: 'graphite-500' });
  });
  cy += 72;
  ab.line(X, cy, X + MW, cy, { stroke: 'line' });
  button(ab, px, cy + 24, 'Назад', { variant: 'secondary' });
  button(ab, X + MW - 32 - 200, cy + 24, 'Перейти к проверке', { w: 200 });
  mainCard.h = cy + 92 - y;

  // Правая колонка — сводка
  const RX = X + MW + 40;
  const RW = 1200 - MW - 40;
  let ry = y;
  card(ab, RX, ry, RW, 360, { r: 16 });
  ab.text(RX + 28, ry + 28, 'Ваша заявка', 'h3');
  ry += 76;
  photo(ab, RX + 28, ry, 64, 64, 'ring', { r: 8 });
  ab.text(RX + 108, ry + 8, 'Кольцо с камнем', 'body-strong');
  ab.text(RX + 108, ry + 32, 'Золото, ювелирное изделие', 'small', { fill: 'graphite-500' });
  ry += 88;
  for (const [k, v] of [['Проба', '585'], ['Вес', '4,2 г'], ['Вставка', 'Фианит'], ['Состояние', 'Хорошее, есть потёртости']]) {
    ry += kv(ab, RX + 28, ry, RW - 56, k, v, { rule: k !== 'Состояние' });
  }
  ab.text(RX + RW - 28, y + 28, 'Изменить', 'small-strong', { fill: 'malachite-700', align: 'right' });

  ry = y + 384;
  card(ab, RX, ry, RW, 220, { r: 16, fill: 'malachite-900', stroke: 'none' });
  ab.text(RX + 28, ry + 28, 'Проверка фото', 'h4', { fill: 'white' });
  ab.text(RX + 28, ry + 54, 'Автоматически, до отправки эксперту', 'caption', { fill: 'malachite-300' });
  const checks = [
    ['check', 'malachite-300', 'Загружено 4 фото из 6'],
    ['check', 'malachite-300', 'Клеймо 585 видно на фото 2'],
    ['alert', 'gold-300', 'Фото 4 темнее нормы'],
  ];
  checks.forEach(([ic, c, t], i) => {
    icon(ab, ic, RX + 28, ry + 92 + i * 36, 20, c, 2, 'malachite-900');
    ab.text(RX + 60, ry + 92 + i * 36, t, 'small', { fill: 'white' });
  });

  ab.h = Math.max(cy + 92 + 64, ry + 260);
  return ab;
}
