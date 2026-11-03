// Строит layout/mockup.json — общий источник данных для SVG-генератора и
// сценария Illustrator (illustrator/lombard-mockup.jsx читает этот файл).
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { buildMockup } from '../layout/index.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const artboards = buildMockup();
const count = (items) => items.reduce((n, it) => n + 1 + (it.children ? count(it.children) : 0), 0);
const out = { generated: 'design/scripts/build-layout.mjs', units: 'px', artboards };
writeFileSync(path.join(ROOT, 'layout', 'mockup.json'), JSON.stringify(out));
for (const ab of artboards) console.log(`${String(ab.index).padStart(2, '0')} ${ab.id.padEnd(22)} ${ab.w}×${ab.h}  ${count(ab.items)} объектов`);
