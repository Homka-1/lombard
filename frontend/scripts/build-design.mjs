// Генератор фронтенд-артефактов из макета этапа 1 (единый источник правды — design/).
//   design/tokens.json        → src/styles/tokens.css        (CSS-переменные)
//   design/layout/kit.mjs     → src/components/icons.gen.ts  (иконки макета, SVG-пути)
// Результат коммитится; запускать после правки токенов: `npm run design`.
// Для иконок нужны зависимости макета: `cd design && npm install`.
// `--check` — только сверить (код выхода 1, если файлы устарели).

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const FRONT = path.resolve(here, "..");
const DESIGN = path.resolve(FRONT, "../design");

const px = (v) => (v === 0 ? "0" : `${v}px`);
const kebab = (s) => s.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

export function tokensToCss(tokens) {
  const out = [];
  const line = (name, value) => out.push(`  --${name}: ${value};`);
  out.push(
    "/* Сгенерировано scripts/build-design.mjs из design/tokens.json — не править вручную. */",
  );
  out.push(`/* ${tokens.$meta.name}, версия ${tokens.$meta.version} */`);
  out.push(":root {");
  for (const [k, v] of Object.entries(tokens.color)) line(`color-${k}`, v.toLowerCase());
  for (const [k, v] of Object.entries(tokens.semantic)) line(`${k}`, `var(--color-${v})`);
  for (const [k, v] of Object.entries(tokens.font))
    line(`font-${k}`, `"${v.family}", ${v.fallback}`);
  for (const [k, v] of Object.entries(tokens.typography)) {
    // tracking — в тысячных долях em (как в Illustrator)
    line(`type-${k}`, `${v.weight} ${px(v.size)}/${px(v.lineHeight)} var(--font-${v.font})`);
    line(`type-${k}-tracking`, v.tracking === 0 ? "normal" : `${v.tracking / 1000}em`);
  }
  for (const [k, v] of Object.entries(tokens.space)) line(`space-${k}`, px(v));
  for (const [k, v] of Object.entries(tokens.radius))
    if (!k.startsWith("_")) line(`radius-${k}`, px(v));
  for (const [k, v] of Object.entries(tokens.border)) line(`border-${k}`, px(v));
  for (const [k, v] of Object.entries(tokens.grid)) {
    if (typeof v !== "object") continue;
    line(`grid-${k}-content`, px(v.content));
    line(`grid-${k}-margin`, px(v.margin));
    line(`grid-${k}-gutter`, px(v.gutter));
  }
  for (const [k, v] of Object.entries(tokens.motion))
    if (!k.startsWith("_")) line(`motion-${kebab(k)}`, v);
  for (const [k, v] of Object.entries(tokens.tone)) {
    line(`tone-${k}-bg`, `var(--color-${v.bg})`);
    line(`tone-${k}-fg`, `var(--color-${v.fg})`);
    line(`tone-${k}-dot`, `var(--color-${v.dot})`);
  }
  out.push("}");
  out.push("");
  out.push(
    `/* Брейкпоинты (для справки, в @media нельзя использовать var): ${Object.entries(
      tokens.breakpoints,
    )
      .map(([k, v]) => `${k} ${v}px`)
      .join(", ")} */`,
  );
  out.push("");
  return out.join("\n");
}

export function statusModule(tokens) {
  const entries = Object.entries(tokens.status)
    .map(
      ([k, v]) => `  ${k}: { label: ${JSON.stringify(v.label)}, tone: ${JSON.stringify(v.tone)} },`,
    )
    .join("\n");
  return `// Сгенерировано scripts/build-design.mjs из design/tokens.json — не править вручную.
export type Tone = ${Object.keys(tokens.tone)
    .map((t) => JSON.stringify(t))
    .join(" | ")};

export const STATUS = {
${entries}
} as const satisfies Record<string, { label: string; tone: Tone }>;

export type ApplicationStatus = keyof typeof STATUS;
`;
}

const r = (n) => Math.round(n * 100) / 100;

export function iconsModule(ICONS) {
  const names = Object.keys(ICONS);
  const body = names
    .map((name) => {
      const d = ICONS[name]()
        .map((p) => {
          const [first, ...rest] = p.pts;
          return `M${r(first[0])} ${r(first[1])}${rest.map(([x, y]) => `L${r(x)} ${r(y)}`).join("")}${p.closed ? "Z" : ""}`;
        })
        .join("");
      return `  ${name}: ${JSON.stringify(d)},`;
    })
    .join("\n");
  return `// Сгенерировано scripts/build-design.mjs из design/layout/kit.mjs — не править вручную.
// Иконки макета: сетка 24×24, обводка 1.75.
export const ICON_PATHS = {
${body}
} as const;

export type IconName = keyof typeof ICON_PATHS;
`;
}

async function main() {
  const check = process.argv.includes("--check");
  const tokens = JSON.parse(readFileSync(path.join(DESIGN, "tokens.json"), "utf8"));
  const files = [
    ["src/styles/tokens.css", tokensToCss(tokens)],
    ["src/design/status.gen.ts", statusModule(tokens)],
  ];
  try {
    const kit = await import(pathToFileURL(path.join(DESIGN, "layout/kit.mjs")).href);
    files.push(["src/components/icons.gen.ts", iconsModule(kit.ICONS)]);
  } catch (err) {
    console.warn(`! Иконки пропущены (нужно \`cd design && npm install\`): ${err.message}`);
  }
  let stale = 0;
  for (const [rel, content] of files) {
    const abs = path.join(FRONT, rel);
    let prev = null;
    try {
      prev = readFileSync(abs, "utf8");
    } catch {
      /* нет файла */
    }
    if (prev === content) continue;
    if (check) {
      console.error(`✗ устарел: ${rel}`);
      stale++;
    } else {
      writeFileSync(abs, content);
      console.log(`✓ ${rel}`);
    }
  }
  if (stale) process.exit(1);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) await main();
