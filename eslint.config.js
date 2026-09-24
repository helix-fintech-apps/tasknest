// ESLint flat config (ESLint 9). Run: `npx eslint .` (CI: --max-warnings=0).
import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

// Money is integer cents. These patterns are how float money sneaks in.
const noFloatMoney = [
  {
    selector: "CallExpression[callee.name='parseFloat']",
    message:
      "Money is integer cents: parse with Number.parseInt / domain helpers, never parseFloat.",
  },
  {
    selector: "CallExpression[callee.object.name='Number'][callee.property.name='parseFloat']",
    message:
      "Money is integer cents: parse with Number.parseInt / domain helpers, never parseFloat.",
  },
  {
    selector: "CallExpression[callee.property.name='toFixed']",
    message:
      "Do not round money with toFixed(); use the integer-cents helpers in _shared/domain/money.ts.",
  },
];

export default defineConfig([
  globalIgnores([
    "**/dist/",
    "**/node_modules/",
    "coverage/",
    "playwright-report/",
    "test-results/",
    "supabase/.temp/",
    "supabase/.branches/",
  ]),

  {
    files: ["**/*.{js,mjs,cjs,ts,tsx}"],
    extends: [js.configs.recommended, tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
    },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
      eqeqeq: ["error", "smart"],
      "no-console": ["warn", { allow: ["warn", "error"] }],
    },
  },

  // Browser app (React).
  {
    files: ["src/**/*.{ts,tsx}"],
    languageOptions: { globals: globals.browser },
    plugins: { "react-hooks": reactHooks },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
    },
  },

  // Edge Functions (Deno) + shared money domain.
  {
    files: ["supabase/functions/**/*.ts"],
    languageOptions: { globals: { ...globals.browser, Deno: "readonly" } },
    rules: {
      "no-restricted-syntax": ["error", ...noFloatMoney],
      "no-console": "off", // Edge Function logs go to Supabase log explorer
    },
  },

  // Tests, e2e, tooling and config files run in Node.
  {
    files: [
      "tests/**/*.ts",
      "e2e/**/*.ts",
      "scripts/**/*.{js,mjs,ts}",
      "*.config.{js,mjs,ts}",
      "eslint.config.js",
    ],
    languageOptions: { globals: { ...globals.node, ...globals.vitest } },
    rules: { "no-console": "off" },
  },
]);
