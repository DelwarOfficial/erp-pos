import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";
import { dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Correctness rules are ON and block the build. Style and preference rules stay
// off: this project does not want to litigate formatting, but it does need the
// rules that catch genuinely broken code.
//
// Previously all 26 rules below were disabled, including no-unreachable,
// no-fallthrough, no-undef and no-redeclare, so "Lint clean (0 errors, 0
// warnings)" on the go-live checklist was satisfiable while unreachable
// branches, switch fallthrough and undefined identifiers passed silently.
const eslintConfig = [...nextCoreWebVitals, ...nextTypescript, {
  rules: {
    // ── Correctness: these catch code that is wrong, not code that is untidy ──
    "no-unreachable": "error",
    "no-fallthrough": "error",
    "no-redeclare": "error",
    "no-dupe-keys": "error",
    "no-dupe-args": "error",
    "no-dupe-else-if": "error",
    "no-duplicate-case": "error",
    "no-self-assign": "error",
    "no-self-compare": "error",
    "no-unsafe-negation": "error",
    "no-unsafe-optional-chaining": "error",
    "no-constant-condition": "error",
    "no-cond-assign": "error",
    "no-compare-neg-zero": "error",
    "use-isnan": "error",
    "valid-typeof": "error",
    "no-debugger": "error",
    "@typescript-eslint/no-unsafe-declaration-merging": "error",
    "@typescript-eslint/no-misused-new": "error",
    "@typescript-eslint/no-duplicate-enum-values": "error",

    // ── Style and preference: deliberately off ──
    "@typescript-eslint/no-explicit-any": "off",
    "@typescript-eslint/no-unused-vars": "off",
    "@typescript-eslint/no-non-null-assertion": "off",
    "@typescript-eslint/ban-ts-comment": "off",
    "@typescript-eslint/prefer-as-const": "off",
    "@typescript-eslint/no-unused-disable-directive": "off",
    "@typescript-eslint/no-empty-object-type": "off",

    "react-hooks/exhaustive-deps": "off",
    "react-hooks/purity": "off",
    "react-hooks/set-state-in-effect": "off",
    "react-hooks/use-memo": "off",
    "react-hooks/immutability": "off",
    "react/no-unescaped-entities": "off",
    "react/display-name": "off",
    "react/prop-types": "off",
    "react-compiler/react-compiler": "off",

    "@next/next/no-img-element": "off",
    "@next/next/no-html-link-for-pages": "off",

    "prefer-const": "off",
    "no-unused-vars": "off",
    "no-console": "off",
    "no-empty": "off",
    "no-irregular-whitespace": "off",
    "no-case-declarations": "off",
    "no-mixed-spaces-and-tabs": "off",
    "no-useless-escape": "off",
  },
}, {
  // no-undef is checked by tsc, and on TypeScript sources the ESLint rule has
  // no type information: it reports React, RequestInit, BodyInit, HeadersInit,
  // AuthenticatorTransport and Bun as undefined. typescript-eslint recommends
  // disabling it for this reason. Plain JavaScript keeps it.
  files: ["**/*.js", "**/*.mjs", "**/*.cjs"],
  rules: { "no-undef": "error" },
}, {
  // require-atomic-updates finds real races in shared server state, and only
  // false positives on client idioms: a useRef reassigned after an await IS
  // the re-entry guard, and `event.target.value = ''` in a finally is the
  // standard file-input reset. Scope it to where a race can actually happen.
  files: ["src/lib/**/*.ts", "src/domain/**/*.ts", "src/app/api/**/*.ts", "src/workers/**/*.ts"],
  rules: { "require-atomic-updates": "error" },
}, {
  // The Next.js rule guards against assigning the bundler's `module` global.
  // In tests `const module = await import(...)` is an ordinary local binding.
  files: ["tests/**/*.ts"],
  rules: { "@next/next/no-assign-module-variable": "off" },
}, {
  ignores: [
    "node_modules/**",
    ".next/**",
    "out/**",
    "build/**",
    // Written by scripts/verify-access-tests.mjs: a full copy of the source
    // tree per test run. Linting these made `eslint .` take 14m34s and report
    // 428,621 problems, almost none of them this project's code.
    ".local/**",
    ".kilo/**",
    "next-env.d.ts",
    "examples/**",
    // Was "skills" without a glob, which does not exclude the directory's
    // contents.
    "skills/**",
    "graphify-out/**",
    "download/**",
    "mini-services/**",
    "tests/load/**",
    "public/sw.js",
    "public/**/*.js",
  ],
}];

export default eslintConfig;
