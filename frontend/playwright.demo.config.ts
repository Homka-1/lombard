import { defineConfig, devices } from "@playwright/test";

/**
 * Smoke of the dependency-free demo (`../demo/index.html`, stage 13): opened straight from
 * disk over file://, no servers. Build it first: `npm run build:demo`. Run: `npm run e2e:demo`.
 */
export default defineConfig({
  testDir: "./e2e",
  testMatch: /.*\.demo\.ts$/,
  outputDir: "./e2e/.results",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 180_000,
  expect: { timeout: 10_000 },
  reporter: [["list"]],
  use: {
    locale: "ru-RU",
    timezoneId: "Asia/Almaty",
    reducedMotion: "reduce",
    trace: "off",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
