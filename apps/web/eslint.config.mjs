import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "out/**",
      "build/**",
      "next-env.d.ts",
    ],
  },
  {
    // The benchmark's answer key never reaches the web app (AGENTS.md section 2); it shows results from GET /bench/results.
    files: ["**/*.ts", "**/*.tsx"],
    rules: {
      "no-restricted-syntax": [
        "error",
        { selector: "Literal[value=/answer_key/]", message: "The web app must not read data/answer_key/." },
        { selector: "TemplateElement[value.raw=/answer_key/]", message: "The web app must not read data/answer_key/." },
      ],
    },
  },
];

export default eslintConfig;
