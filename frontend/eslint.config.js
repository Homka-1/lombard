import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist", "coverage"] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: { ecmaVersion: 2022, globals: globals.browser },
    plugins: { "react-hooks": reactHooks, "react-refresh": reactRefresh },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
    },
  },
  {
    // мок-бэкенд демо-версии: обычный скрипт без модулей, грузится с file:// (этап 13)
    files: ["demo-src/**/*.js"],
    extends: [js.configs.recommended],
    languageOptions: {
      ecmaVersion: 2017,
      sourceType: "script",
      globals: { ...globals.browser, globalThis: "readonly" },
    },
    // в ES2017 нет `catch {}` без переменной
    rules: { "no-unused-vars": ["error", { caughtErrors: "none" }] },
  },
  {
    // тестовые утилиты экспортируют и компоненты, и функции — fast refresh им не нужен
    files: ["src/test/**", "**/*.test.{ts,tsx}"],
    rules: { "react-refresh/only-export-components": "off" },
  },
);
