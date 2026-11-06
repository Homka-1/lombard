/**
 * Сборка демо-версии без зависимостей (этап 13): `../demo/` из исходников фронтенда.
 *
 *   npm run build:demo          # пересобрать demo/ (результат коммитится)
 *   npm run build:demo -- --check   # собрать во временную папку и сверить с demo/
 *
 * Что получается — только обычные файлы, которые браузер открывает с диска (file://):
 *   demo/index.html          — страница с <script src> (без type="module" и без fetch файлов)
 *   demo/js/app.js           — тот же React-интерфейс, собранный в один IIFE-скрипт
 *                              (режим "demo": HashRouter и панель демо-режима)
 *   demo/js/mock-api.js      — мок-бэкенд на localStorage (из demo-src/, без изменений)
 *   demo/js/seed-photos.js   — фото для демо-заявки (из e2e/fixtures, data URL)
 *   demo/css/app.css         — стили: CSS-переменные из design/tokens.json + модули страниц
 *   demo/fonts/*             — Spectral и Golos Text (кириллица) из @fontsource
 *   demo/favicon.svg
 * demo/README.md пишется вручную и сборкой не трогается.
 */
import { build } from "vite";
import react from "@vitejs/plugin-react";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, mkdir, writeFile, copyFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const demoDir = path.resolve(root, "../demo");
const check = process.argv.includes("--check");
const GENERATED = ["index.html", "favicon.svg", "js", "css", "fonts", "assets"];
const SEED_PHOTOS = ["ring-1.jpg", "ring-2.jpg", "ring-3.jpg"];

async function exists(p) {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

async function buildInto(outDir) {
  for (const name of GENERATED) await rm(path.join(outDir, name), { recursive: true, force: true });
  await mkdir(path.join(outDir, "js"), { recursive: true });

  process.env.NODE_ENV = "production";
  await build({
    configFile: false,
    root,
    mode: "demo",
    base: "./",
    publicDir: false,
    logLevel: "warn",
    plugins: [react()],
    define: { "process.env.NODE_ENV": JSON.stringify("production") },
    build: {
      outDir,
      emptyOutDir: false,
      assetsDir: "assets",
      assetsInlineLimit: 0,
      cssCodeSplit: false,
      modulePreload: false,
      sourcemap: false,
      reportCompressedSize: false,
      rollupOptions: {
        input: path.join(root, "src/main.tsx"),
        output: {
          // Классический скрипт: ES-модули не загружаются со страницы file://.
          format: "iife",
          inlineDynamicImports: true,
          entryFileNames: "js/app.js",
          assetFileNames: (info) => {
            const name = info.names?.[0] ?? info.name ?? "";
            if (name.endsWith(".css")) return "css/app.css";
            if (/\.(woff2?|ttf|otf)$/.test(name)) return "fonts/[name][extname]";
            return "assets/[name][extname]";
          },
        },
      },
    },
  });

  await copyFile(path.join(root, "demo-src/mock-api.js"), path.join(outDir, "js/mock-api.js"));
  await copyFile(path.join(root, "public/favicon.svg"), path.join(outDir, "favicon.svg"));

  const photos = [];
  for (const name of SEED_PHOTOS) {
    const data = await readFile(path.join(root, "e2e/fixtures", name));
    photos.push({ name, dataUrl: `data:image/jpeg;base64,${data.toString("base64")}` });
  }
  await writeFile(
    path.join(outDir, "js/seed-photos.js"),
    "/* Сгенерировано scripts/build-demo.mjs из frontend/e2e/fixtures — фото демо-заявки. */\n" +
      `window.LOMBARD_DEMO_SEED_PHOTOS = ${JSON.stringify(photos)};\n`,
  );

  await copyFile(path.join(root, "demo-src/index.html"), path.join(outDir, "index.html"));
}

async function listFiles(dir, base = dir) {
  const out = [];
  if (!(await exists(dir))) return out;
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await listFiles(full, base)));
    else out.push(path.relative(base, full));
  }
  return out.sort();
}

async function digest(dir) {
  const result = new Map();
  for (const name of GENERATED) {
    const p = path.join(dir, name);
    if (!(await exists(p))) continue;
    const files = (await stat(p)).isDirectory()
      ? (await listFiles(p)).map((f) => path.join(name, f))
      : [name];
    for (const f of files) {
      const hash = createHash("sha256")
        .update(await readFile(path.join(dir, f)))
        .digest("hex");
      result.set(f.split(path.sep).join("/"), hash);
    }
  }
  return result;
}

if (check) {
  const tmp = await mkdtemp(path.join(tmpdir(), "lombard-demo-"));
  try {
    await buildInto(tmp);
    const [fresh, committed] = await Promise.all([digest(tmp), digest(demoDir)]);
    const problems = [];
    for (const [f, h] of fresh) {
      if (!committed.has(f)) problems.push(`нет файла: demo/${f}`);
      else if (committed.get(f) !== h) problems.push(`устарел: demo/${f}`);
    }
    for (const f of committed.keys()) if (!fresh.has(f)) problems.push(`лишний файл: demo/${f}`);
    if (problems.length) {
      console.error(
        `demo/ не совпадает с исходниками — запустите npm run build:demo\n  ${problems.join("\n  ")}`,
      );
      process.exitCode = 1;
    } else {
      console.log(`demo/ актуальна (${fresh.size} файлов)`);
    }
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
} else {
  await buildInto(demoDir);
  const files = await digest(demoDir);
  let size = 0;
  for (const f of files.keys()) size += (await stat(path.join(demoDir, f))).size;
  console.log(`demo/ собрана: ${files.size} файлов, ${(size / 1024 / 1024).toFixed(1)} МБ`);
}
