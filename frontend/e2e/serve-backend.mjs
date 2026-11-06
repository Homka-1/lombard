// Starts the backend for e2e tests on a fresh SQLite database:
// alembic upgrade head → python -m app.seed → uvicorn. Used by playwright.config.ts.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const backendDir = resolve(here, "../../backend");
const port = process.env.E2E_BACKEND_PORT ?? "8001";
const dataDir = join(backendDir, ".e2e");

function findPython() {
  if (process.env.E2E_PYTHON) return process.env.E2E_PYTHON;
  const venv =
    process.platform === "win32"
      ? join(backendDir, ".venv", "Scripts", "python.exe")
      : join(backendDir, ".venv", "bin", "python");
  if (existsSync(venv)) return venv;
  return process.platform === "win32" ? "python" : "python3";
}

const python = findPython();
rmSync(dataDir, { recursive: true, force: true });

const env = {
  ...process.env,
  LOMBARD_ENVIRONMENT: "test",
  LOMBARD_TIME_TRAVEL: "true",
  LOMBARD_DATABASE_URL: "sqlite:///./.e2e/lombard-e2e.db",
  LOMBARD_UPLOAD_DIR: "./.e2e/uploads",
  PYTHONUNBUFFERED: "1",
};

function run(args) {
  const result = spawnSync(python, args, { cwd: backendDir, env, stdio: "inherit" });
  if (result.status !== 0) {
    console.error(`[e2e] failed: ${python} ${args.join(" ")}`);
    process.exit(result.status ?? 1);
  }
}

// SQLite creates the file, but not its directory.
spawnSync(python, ["-c", "import os; os.makedirs('.e2e', exist_ok=True)"], {
  cwd: backendDir,
  env,
});
run(["-m", "alembic", "upgrade", "head"]);
run(["-m", "app.seed"]);

const server = spawn(
  python,
  ["-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", port],
  { cwd: backendDir, env, stdio: "inherit" },
);
const stop = () => server.kill("SIGTERM");
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
server.on("exit", (code) => process.exit(code ?? 0));
