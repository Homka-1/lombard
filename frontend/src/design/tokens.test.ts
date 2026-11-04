import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
// @ts-expect-error — JS-модуль генератора без типов
import { statusModule, tokensToCss } from "../../scripts/build-design.mjs";

const root = path.resolve(__dirname, "../..");
const tokens = JSON.parse(readFileSync(path.join(root, "../design/tokens.json"), "utf8"));

describe("design tokens → CSS", () => {
  it("generated files are up to date with design/tokens.json", () => {
    // Если тест упал: `npm run design` и закоммитить результат.
    expect(readFileSync(path.join(root, "src/styles/tokens.css"), "utf8")).toBe(
      tokensToCss(tokens),
    );
    expect(readFileSync(path.join(root, "src/design/status.gen.ts"), "utf8")).toBe(
      statusModule(tokens),
    );
  });

  it("exposes palette, semantic aliases, type scale and tones", () => {
    const css: string = tokensToCss(tokens);
    expect(css).toContain("--color-malachite-700: #136150;");
    expect(css).toContain("--primary: var(--color-malachite-700);");
    expect(css).toContain('--font-display: "Spectral", Georgia');
    expect(css).toContain("--type-display: 400 68px/72px var(--font-display);");
    expect(css).toContain("--type-display-tracking: -0.02em;");
    expect(css).toContain("--radius-lg: 12px;");
    expect(css).toContain("--tone-gold-bg: var(--color-gold-100);");
    expect(css).not.toMatch(/shadow/);
  });
});
