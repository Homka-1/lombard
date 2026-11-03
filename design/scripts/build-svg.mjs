// SVG-«двойник» сценария Illustrator: рисует layout/mockup.json в previews/svg/*.svg.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tokens = JSON.parse(readFileSync(path.join(ROOT, 'tokens.json'), 'utf8'));
const mockup = JSON.parse(readFileSync(path.join(ROOT, 'layout', 'mockup.json'), 'utf8'));
const OUT = path.join(ROOT, 'previews', 'svg');
mkdirSync(OUT, { recursive: true });

const color = (c) => (!c || c === 'none' ? 'none' : c.startsWith('#') ? c : tokens.color[c] || tokens.color[tokens.semantic[c]] || (() => { throw new Error('Нет цвета ' + c); })());
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const n = (v) => Math.round(v * 100) / 100;

function fontFaces() {
  const out = [];
  for (const fam of Object.values(tokens.font)) {
    for (const [w, file] of Object.entries(fam.files)) {
      out.push(`@font-face{font-family:'${fam.family}';font-weight:${w};src:url('../../${file}') format('truetype');}`);
    }
  }
  return out.join('\n');
}
function filters() {
  return Object.entries(tokens.shadow).map(([k, s]) =>
    `<filter id="sh-${k}" x="-20%" y="-20%" width="140%" height="160%"><feDropShadow dx="${s.x}" dy="${s.y}" stdDeviation="${s.blur / 2}" flood-color="${s.color}" flood-opacity="${s.opacity}"/></filter>`).join('');
}
function common(it) {
  let a = ` fill="${color(it.fill)}"`;
  if (it.stroke && it.stroke !== 'none') a += ` stroke="${color(it.stroke)}" stroke-width="${it.sw}"`;
  if (it.dash) a += ` stroke-dasharray="${it.dash.join(' ')}"`;
  if (it.op != null) a += ` opacity="${it.op}"`;
  if (it.shadow) a += ` filter="url(#sh-${it.shadow})"`;
  return a;
}
function render(it) {
  switch (it.t) {
    case 'group':
      return `<g data-name="${esc(it.name)}">${it.children.map(render).join('')}</g>`;
    case 'rect': {
      const r = Math.min(it.r, it.w / 2, it.h / 2);
      return `<rect x="${it.x}" y="${it.y}" width="${it.w}" height="${it.h}"${r ? ` rx="${n(r)}"` : ''}${common(it)}/>`;
    }
    case 'ellipse':
      return `<ellipse cx="${n(it.x + it.w / 2)}" cy="${n(it.y + it.h / 2)}" rx="${n(it.w / 2)}" ry="${n(it.h / 2)}"${common(it)}/>`;
    case 'path': {
      const d = 'M' + it.pts.map((p) => p.join(' ')).join('L') + (it.closed ? 'Z' : '');
      return `<path d="${d}" stroke-linecap="round" stroke-linejoin="round"${common(it)}/>`;
    }
    case 'text': {
      const st = tokens.typography[it.style];
      const fam = tokens.font[st.font];
      const anchor = { left: 'start', center: 'middle', right: 'end' }[it.align];
      const spans = it.lines.map((l, i) => `<tspan x="${it.x}" ${i ? `dy="${st.lineHeight}"` : `y="${it.y}"`}>${esc(l)}</tspan>`).join('');
      return `<text font-family="'${fam.family}', ${fam.fallback.replace(/"/g, "'")}" font-size="${st.size}" font-weight="${st.weight}" letter-spacing="${n((st.tracking / 1000) * st.size)}" text-anchor="${anchor}" fill="${color(it.fill)}"${it.op != null ? ` opacity="${it.op}"` : ''} xml:space="preserve">${spans}</text>`;
    }
    default:
      throw new Error('Неизвестный примитив ' + it.t);
  }
}

for (const ab of mockup.artboards) {
  const file = `${String(ab.index).padStart(2, '0')}-${ab.id}.svg`;
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${ab.w}" height="${ab.h}" viewBox="0 0 ${ab.w} ${ab.h}">
<title>${esc(ab.title)}</title>
<defs><style>${fontFaces()}
text{font-kerning:normal;font-variant-numeric:lining-nums}</style>${filters()}</defs>
<rect width="${ab.w}" height="${ab.h}" fill="${color(ab.bg)}"/>
${ab.items.map(render).join('\n')}
</svg>
`;
  writeFileSync(path.join(OUT, file), svg);
  console.log('svg', file, Math.round(svg.length / 1024) + ' КБ');
}
