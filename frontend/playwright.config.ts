import { defineConfig, devices } from "@playwright/test";

const backendPort = process.env.E2E_BACKEND_PORT ?? "8001";
const frontendPort = process.env.E2E_FRONTEND_PORT ?? "5174";
/** An already running stand (e.g. `docker compose up`): no servers are started then. */
const externalUrl = process.env.E2E_BASE_URL;

/**
 * E2E smoke: a fresh backend (SQLite in backend/.e2e, seed data, time travel on)
 * and the Vite dev server proxied to it. Run: `npm run e2e`.
 */
export default defineConfig({
  testDir: "./e2e",
  testMatch: /.*\.e2e\.ts$/,
  outputDir: "./e2e/.results",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 10_000 },
  reporter: [["list"]],
  use: {
    baseURL: externalUrl ?? `http://127.0.0.1:${frontendPort}`,
    locale: "ru-RU",
    timezoneId: "Asia/Almaty",
    // Без анимаций: axe не должен замерять контраст элементов в середине fade-in.
    reducedMotion: "reduce",
    trace: "off",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: externalUrl
    ? undefined
    : [
        {
          command: "node e2e/serve-backend.mjs",
          url: `http://127.0.0.1:${backendPort}/api/health`,
          env: { E2E_BACKEND_PORT: backendPort },
          reuseExistingServer: Boolean(process.env.E2E_REUSE),
          timeout: 120_000,
        },
        {
          command: `npx vite --port ${frontendPort} --strictPort --host 127.0.0.1`,
          url: `http://127.0.0.1:${frontendPort}`,
          env: { VITE_BACKEND_URL: `http://127.0.0.1:${backendPort}` },
          reuseExistingServer: Boolean(process.env.E2E_REUSE),
          timeout: 120_000,
        },
      ],
});
