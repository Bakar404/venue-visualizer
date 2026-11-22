import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // Photos and renders are user files served by the local API at arbitrary sizes; next/image adds nothing here.
      "@next/next/no-img-element": "off",
    },
  },
  {
    files: ["e2e/**/*.ts"],
    rules: {
      "no-restricted-properties": [
        "error",
        { property: "waitForTimeout", message: "Wait for a condition (expect, expect.poll, a held mock request) instead of a fixed sleep." },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
