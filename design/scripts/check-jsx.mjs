// Проверка сценария Illustrator без Illustrator:
//  1. синтаксис строго ES3 (acorn, ecmaVersion: 3);
//  2. нет API, которых нет в ExtendScript (JSON, forEach, map, indexOf у массивов, trim…);
//  3. прогон сценария в Node на мок-модели Illustrator DOM: сценарий должен
//     прочитать tokens.json и layout/mockup.json и создать ровно столько
//     объектов, сколько примитивов в макете, без ошибок.
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import path from 'node:path';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const acorn = require('acorn');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const JSX = path.join(ROOT, 'illustrator', 'lombard-mockup.jsx');
const src = readFileSync(JSX, 'utf8');
let failed = 0;
const ok = (m) => console.log('  ✓ ' + m);
const fail = (m) => { failed++; console.log('  ✗ ' + m); };

// Директивы препроцессора ExtendScript (#target, #include) — не JS, заменяем пустой строкой
const code = src.replace(/^#.*$/gm, '');

console.log('1. Синтаксис ES3');
try {
  acorn.parse(code, { ecmaVersion: 3, sourceType: 'script', allowReserved: false });
  ok('acorn ecmaVersion 3: разбор без ошибок');
} catch (e) {
  fail('acorn ES3: ' + e.message);
}

console.log('2. Запрещённые конструкции');
const stripped = code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '').replace(/'(?:\\.|[^'\\])*'/g, "''");
const banned = [
  [/\bJSON\./, 'JSON'], [/\.forEach\(/, 'Array.forEach'], [/\.map\(/, 'Array.map'], [/\.filter\(/, 'Array.filter'],
  [/\.reduce\(/, 'Array.reduce'], [/\.indexOf\(/, 'indexOf (у массивов нет в ES3)'], [/\.trim\(/, 'String.trim'],
  [/Object\.keys/, 'Object.keys'], [/\.bind\(/, 'Function.bind'], [/Date\.now/, 'Date.now'], [/=>/, 'стрелочные функции'],
  [/\b(let|const|class)\s/, 'let/const/class'], [/`/, 'шаблонные строки'], [/\.\.\./, 'spread'],
];
for (const [re, name] of banned) {
  if (re.test(stripped)) fail('найдено: ' + name);
}
if (!failed) ok('нет современных API и синтаксиса');

console.log('3. Прогон на мок-модели Illustrator');
const mockupPath = path.join(ROOT, 'layout', 'mockup.json');
if (!existsSync(mockupPath)) {
  fail('нет layout/mockup.json — выполните npm run layout');
} else {
  const mockup = JSON.parse(readFileSync(mockupPath, 'utf8'));
  const tokens = JSON.parse(readFileSync(path.join(ROOT, 'tokens.json'), 'utf8'));
  const expect = { rect: 0, ellipse: 0, path: 0, text: 0, group: 0 };
  const walk = (items) => items.forEach((it) => { expect[it.t]++; if (it.children) walk(it.children); });
  mockup.artboards.forEach((ab) => walk(ab.items));

  const created = { rect: 0, ellipse: 0, path: 0, text: 0, group: 0, bg: 0 };
  const problems = [];
  class RGBColor { constructor() { this.red = 0; this.green = 0; this.blue = 0; } }
  class SpotColor { constructor() { this.tint = 100; } }
  const checkColor = (c, where) => {
    if (c == null) return;
    if (c instanceof SpotColor) { if (!c.spot || !c.spot.color) problems.push('пустой spot в ' + where); return; }
    if (c instanceof RGBColor) { if ([c.red, c.green, c.blue].some((v) => !(v >= 0 && v <= 255))) problems.push('RGB вне диапазона в ' + where); return; }
    problems.push('неизвестный тип цвета в ' + where);
  };
  const paintable = (kind) => {
    const o = { kind, name: '' };
    return new Proxy(o, {
      set(t, k, v) {
        if (k === 'fillColor' || k === 'strokeColor') checkColor(v, kind + '.' + k);
        if (k === 'opacity' && !(v >= 0 && v <= 100)) problems.push('opacity вне 0..100: ' + v);
        t[k] = v; return true;
      },
    });
  };
  const container = () => ({
    groupItems: { add() { created.group++; return Object.assign(paintable('group'), container()); } },
    pathItems: {
      rectangle(top, left, w, h) { if (!(w >= 0 && h >= 0)) problems.push('rect с отрицательным размером'); created.rect++; return paintable('rect'); },
      roundedRectangle(top, left, w, h, rx, ry) { if (!(rx >= 0)) problems.push('radius < 0'); created.rect++; return paintable('rect'); },
      ellipse() { created.ellipse++; return paintable('ellipse'); },
      add() {
        created.path++;
        const p = paintable('path');
        p.setEntirePath = (pts) => { if (!Array.isArray(pts) || pts.length < 2 || pts.some((q) => q.length !== 2 || q.some((v) => !Number.isFinite(v)))) problems.push('плохие точки контура'); };
        return p;
      },
    },
    textFrames: {
      pointText(anchor) {
        if (!anchor.every(Number.isFinite)) problems.push('плохая точка текста');
        created.text++;
        const charAttrs = new Proxy({}, { set(t, k, v) { if (k === 'fillColor') checkColor(v, 'text'); t[k] = v; return true; } });
        return { textRange: { paragraphAttributes: {}, characterAttributes: charAttrs }, contents: '', name: '' };
      },
    },
  });
  // Мок «установлены не все шрифты»: Golos есть, Spectral — нет (проверяем ветку fallback)
  const installed = new Set(Object.values(tokens.font.text.postscript));
  const styleObj = () => ({ characterAttributes: {}, applyTo() {} });
  const spotsList = [];
  const artboards = [];
  const layers = [];
  const doc = {
    swatchGroups: { add: () => ({ addSpot() {} }) },
    spots: { add: () => { const s = {}; spotsList.push(s); return s; } },
    characterStyles: { add: styleObj },
    paragraphStyles: { add: styleObj },
    artboards: Object.assign(artboards, {
      add(rect) { if (!(rect[0] < rect[2] && rect[1] > rect[3])) problems.push('artboardRect перевёрнут'); const a = { artboardRect: rect }; artboards.push(a); return a; },
      setActiveArtboardIndex() {},
    }),
    layers: Object.assign(layers, { add() { const l = Object.assign({ move() {} }, container()); layers.push(l); return l; } }),
  };
  artboards.push({ artboardRect: [0, 0, 1, -1] });
  layers.push(Object.assign({ move() {} }, container()));

  let alertText = '';
  class File {
    constructor(p) { this.p = p; }
    get parent() { return new File(path.dirname(this.p)); }
    get fsName() { return this.p; }
    get exists() { return existsSync(this.p); }
    open() { return true; }
    read() { return readFileSync(this.p, this.encoding === 'UTF-8' ? 'utf8' : 'latin1'); }
    close() {}
  }
  const sandbox = {
    $: { fileName: JSX },
    File, RGBColor, SpotColor,
    app: {
      documents: { add: () => doc },
      textFonts: { getByName(n) { if (!installed.has(n)) throw new Error('No such font'); return { name: n }; } },
      coordinateSystem: null,
    },
    alert: (m) => { alertText = m; },
    ColorModel: { PROCESS: 'PROCESS' },
    DocumentColorSpace: { RGB: 'RGB' },
    CoordinateSystem: { DOCUMENTCOORDINATESYSTEM: 'DOC' },
    StrokeCap: { ROUNDENDCAP: 1 }, StrokeJoin: { ROUNDENDJOIN: 1 },
    Justification: { LEFT: 'L', CENTER: 'C', RIGHT: 'R' },
    ElementPlacement: { PLACEATEND: 'END' },
  };
  vm.runInNewContext(code, sandbox, { filename: 'lombard-mockup.jsx' });

  if (alertText.startsWith('Ошибка')) fail(alertText);
  else ok('сценарий отработал: ' + alertText.split('\n')[0]);
  const n = mockup.artboards.length;
  if (artboards.length === n) ok(`артбордов: ${n}`); else fail(`артбордов ${artboards.length}, ожидалось ${n}`);
  if (layers.length === n) ok(`слоёв: ${n}`); else fail(`слоёв ${layers.length}, ожидалось ${n}`);
  if (spotsList.length === Object.keys(tokens.color).length) ok(`глобальных образцов: ${spotsList.length}`); else fail('число образцов не совпадает с tokens.color');
  for (const k of ['ellipse', 'path', 'text', 'group']) {
    if (created[k] === expect[k]) ok(`${k}: ${created[k]}`); else fail(`${k}: создано ${created[k]}, в макете ${expect[k]}`);
  }
  if (created.rect === expect.rect + n) ok(`rect: ${expect.rect} + ${n} фонов`); else fail(`rect: создано ${created.rect}, ожидалось ${expect.rect + n}`);
  if (/Spectral/.test(alertText)) ok('недостающие шрифты попадают в отчёт');
  else fail('отчёт не сообщает о недостающих шрифтах');
  if (problems.length) fail('проблемы: ' + [...new Set(problems)].slice(0, 5).join('; '));
  else ok('все цвета, точки и размеры корректны');
}

console.log(failed ? `\nПроверка не пройдена: ${failed}` : '\nВсе проверки пройдены');
process.exit(failed ? 1 : 0);
