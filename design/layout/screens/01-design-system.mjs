import {
  Artboard, tokens, measure, logo, button, field, badge, stepper, hallmark, guilloche, rosette,
  icon, toast, card, segmented, slider, checkbox, chip, photo,
} from '../kit.mjs';

const ICON_NAMES = ['camera', 'upload', 'check', 'close', 'plus', 'chevronDown', 'clock', 'shield', 'truck', 'card',
  'pin', 'phone', 'user', 'zoom', 'calendar', 'doc', 'bell', 'scale', 'grid', 'list', 'chart', 'users', 'tag', 'route', 'info', 'alert', 'refresh', 'menu'];

export default function designSystem() {
  const W = 1440;
  const ab = new Artboard('design-system', '1. Дизайн-система', W, 2560, 'paper');
  const X = 80;

  // Шапка листа
  ab.group('title', () => {
    ab.rect(0, 0, W, 220, { fill: 'malachite-900' });
    guilloche(ab, 760, 40, 640, 140, { color: 'gold-300', op: 0.28, lines: 8, periods: 5 });
    logo(ab, X, 44, { inverse: true });
    ab.text(X, 104, 'Дизайн-система', 'h1', { fill: 'white' });
    ab.text(X, 166, 'Надёжность и ювелирная точность: малахит, клеймо пробы и гильоширная сетка залогового билета.', 'body', { fill: 'malachite-300' });
  });

  // Палитра
  let y = 268;
  ab.text(X, y, 'Цвет', 'h2');
  y += 60;
  const rows = [
    ['Малахит — основной цвет, действия и навигация', ['malachite-950', 'malachite-900', 'malachite-800', 'malachite-700', 'malachite-600', 'malachite-300', 'malachite-100', 'malachite-50']],
    ['Проба — только металл, клеймо и фокус', ['gold-700', 'gold-500', 'gold-300', 'gold-100']],
    ['Бумага и графит — фон, текст, линии', ['paper', 'surface', 'surface-sunken', 'line', 'line-strong', 'graphite-400', 'graphite-500', 'graphite-700', 'graphite-900']],
    ['Статусы заявки', ['info-700', 'info-100', 'success-700', 'success-100', 'warning-700', 'warning-100', 'danger-700', 'danger-100']],
  ];
  ab.group('palette', () => {
    for (const [title, names] of rows) {
      ab.text(X, y, title, 'small-strong', { fill: 'graphite-700' });
      y += 30;
      names.forEach((nm, i) => {
        const sx = X + i * 140;
        ab.rect(sx, y, 128, 64, { r: 10, fill: nm, stroke: ['surface', 'paper', 'gold-100', 'malachite-50'].includes(nm) ? 'line' : 'none' });
        ab.text(sx, y + 72, nm, 'caption', { fill: 'graphite-700' });
        ab.text(sx, y + 88, tokens.color[nm], 'caption', { fill: 'graphite-500' });
      });
      y += 124;
    }
  });

  // Типографика (правая колонка не нужна — ставим под палитрой)
  y += 12;
  ab.text(X, y, 'Типографика', 'h2');
  ab.text(X + 360, y + 12, 'Spectral — заголовки и суммы, Golos Text — интерфейс и текст', 'body', { fill: 'graphite-500' });
  y += 64;
  const specimens = [
    ['display', 'Деньги под залог по фото'],
    ['h1', 'Предварительная оценка готова'],
    ['h2', 'Как это работает'],
    ['amount-xl', '112 000 – 127 000 ₸'],
    ['h3', 'Параметры изделия'],
    ['lead', 'Эксперт посмотрит фото и пришлёт условия займа за 15 минут.'],
    ['body', 'Курьер приедет в выбранный интервал, при вас упакует изделие в сейф-пакет и выдаст акт.'],
    ['small', 'Вес указан без вставок. Если не знаете пробу, сфотографируйте клеймо крупно.'],
    ['label', 'Проба металла'],
    ['caption', 'Обновлено 3 ноября в 14:20'],
  ];
  ab.group('type', () => {
    for (const [st, sample] of specimens) {
      const s = tokens.typography[st];
      const fam = tokens.font[s.font].family;
      ab.text(X, y + Math.max(0, (s.lineHeight - 20) / 2), `${st}`, 'small-strong', { fill: 'malachite-700' });
      ab.text(X, y + Math.max(0, (s.lineHeight - 20) / 2) + 20, `${fam} ${s.weight}, ${s.size}/${s.lineHeight}`, 'caption', { fill: 'graphite-500' });
      ab.text(X + 240, y, sample, st, { fill: 'text' });
      y += Math.max(s.lineHeight, 40) + 20;
      ab.line(X, y - 10, W - X, y - 10, { stroke: 'line' });
    }
  });

  // Правая часть нижнего блока: элементы управления
  y += 30;
  const top = y;
  ab.text(X, y, 'Кнопки', 'h2');
  y += 64;
  ab.group('buttons', () => {
    let bx = X;
    for (const [label, variant] of [['Оценить изделие', 'primary'], ['Рассчитать займ', 'secondary'], ['Подробнее об условиях', 'ghost']]) {
      bx += button(ab, bx, y, label, { variant }).w + 16;
    }
    y += 64;
    bx = X;
    for (const [label, variant] of [['Отклонить', 'danger'], ['Отправить', 'disabled'], ['Фокус с клавиатуры', 'focus']]) {
      bx += button(ab, bx, y, label, { variant }).w + 20;
    }
    y += 64;
    bx = X;
    bx += button(ab, bx, y, 'Вызвать курьера', { variant: 'primary', size: 'l', icon: 'truck' }).w + 16;
    bx += button(ab, bx, y + 4, 'Добавить фото', { variant: 'secondary', icon: 'camera' }).w + 16;
    bx += button(ab, bx, y + 8, 'Принять', { variant: 'primary', size: 's' }).w + 24;
    y += 76;
    ab.rect(X, y, 560, 92, { r: 16, fill: 'malachite-900' });
    button(ab, X + 24, y + 24, 'Получить деньги', { variant: 'inverse' });
    ab.text(X + 220, y + 24, 'Кнопка на тёмном фоне —', 'small', { fill: 'malachite-300' });
    ab.text(X + 220, y + 44, 'цвет пробы, а не малахит', 'small', { fill: 'malachite-300' });
  });

  // Поля
  y = top;
  const FX = 760;
  ab.text(FX, y, 'Поля ввода', 'h2');
  y += 64;
  ab.group('fields', () => {
    field(ab, FX, y, 280, { label: 'Вес изделия', value: '4,2', suffix: 'г', hint: 'Без камней и вставок' });
    field(ab, FX + 304, y, 296, { label: 'Проба', value: '585', select: true, state: 'focus' });
    y += 112;
    field(ab, FX, y, 280, { label: 'Телефон', value: '+7 701 123-45', state: 'error', error: 'Номер неполный: нужно 10 цифр' });
    field(ab, FX + 304, y, 296, { label: 'Бренд', placeholder: 'Например, Cartier' });
    y += 112;
    segmented(ab, FX, y, ['Золото', 'Серебро', 'Платина'], 0);
    checkbox(ab, FX + 304, y + 9, 'Есть документы и бирка', true);
    y += 64;
    ab.text(FX, y, 'Срок займа', 'label', { fill: 'graphite-700' });
    ab.text(FX + 600, y, '30 дней', 'small-strong', { fill: 'malachite-900', align: 'right' });
    slider(ab, FX, y + 26, 600, 0.43);
  });

  // Бейджи статусов
  y = Math.max(y + 80, top + 420);
  ab.text(X, y, 'Статусы заявки', 'h2');
  ab.text(X + 330, y + 12, 'Цвет — по смыслу: синий — ждём, золотой — есть предложение, зелёный — деньги, красный — внимание', 'body', { fill: 'graphite-500' });
  y += 64;
  ab.group('badges', () => {
    let bx = X;
    for (const key of Object.keys(tokens.status)) {
      const w = measure(tokens.status[key].label, 'label') + 32;
      if (bx + w > W - X) { bx = X; y += 40; }
      badge(ab, bx, y, key);
      bx += w + 12;
    }
  });
  y += 72;

  // Степпер и таймлайн
  ab.text(X, y, 'Степпер мастера заявки', 'h3');
  ab.text(760, y, 'Чипы-фильтры', 'h3');
  y += 48;
  stepper(ab, X + 30, y, 520, ['Изделие', 'Параметры', 'Фото', 'Проверка'], 2);
  let cx = 760;
  for (const [t, a] of [['Все', true], ['Новые', false], ['Нужны фото', false], ['На осмотре', false]]) cx += chip(ab, cx, y, t, { active: a }) + 8;
  y += 100;

  // Фирменные элементы
  ab.text(X, y, 'Клеймо и гильош', 'h2');
  ab.text(X + 330, y + 12, 'Клеймо отмечает оценку и пробу металла. Гильош — только на залоговом билете и тёмных плашках.', 'body', { fill: 'graphite-500' });
  y += 72;
  ab.group('brand', () => {
    hallmark(ab, X + 50, y + 40, '585');
    hallmark(ab, X + 150, y + 40, '750');
    hallmark(ab, X + 250, y + 40, '925', { color: 'graphite-500' });
    hallmark(ab, X + 370, y + 40, '92%', { w: 90, color: 'malachite-700' });
    ab.text(X, y + 84, 'Золото 585 и 750, серебро 925, уверенность оценки', 'caption', { fill: 'graphite-500' });
    ab.rect(X + 470, y - 10, 400, 110, { r: 24, fill: 'malachite-900' });
    guilloche(ab, X + 490, y + 5, 360, 80, { color: 'gold-300', op: 0.45 });
    rosette(ab, X + 960, y + 45, 56, { color: 'gold-500', op: 0.7 });
    photo(ab, X + 1060, y - 10, 110, 110, 'ring', { label: 'Фото 1' });
    photo(ab, X + 1180, y - 10, 100, 110, 'watch', { dark: true });
  });
  y += 150;

  // Иконки, уведомление, карточка
  ab.text(X, y, 'Иконки', 'h3');
  ab.text(760, y, 'Уведомление и карточка', 'h3');
  y += 44;
  ab.group('icons', () => {
    ICON_NAMES.forEach((nm, i) => {
      const ix = X + (i % 10) * 60;
      const iy = y + Math.floor(i / 10) * 56;
      ab.rect(ix, iy, 44, 44, { r: 10, fill: 'surface', stroke: 'line' });
      icon(ab, nm, ix + 10, iy + 10, 24, 'malachite-800');
    });
  });
  toast(ab, 760, y, 380, 'Курьер вызван', 'Приедет завтра с 10:00 до 12:00', { tone: 'success' });
  card(ab, 760, y + 96, 600, 92);
  icon(ab, 'shield', 784, y + 120, 28, 'malachite-700');
  ab.text(828, y + 116, 'Изделие застраховано на время перевозки', 'body-strong');
  ab.text(828, y + 140, 'Сумма страховки равна экспертной оценке', 'small', { fill: 'graphite-500' });

  ab.h = Math.ceil((y + 96 + 92 + 80) / 8) * 8;
  return ab;
}
