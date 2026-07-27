// @corestack/eslint-config — shared flat config.
// Correctness rules only: Prettier owns formatting (docs/engineering/10-repository-structure.md §6).
// The layer-boundary zones below are the machine enforcement of the dependency
// rule (Architecture §4). Baseline implementation; hardened in E01-T02.

import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

const noNodeBuiltins = {
  group: ["node:*"],
  message:
    "domain/application layers are runtime-agnostic (ADR-0001): no Node builtins. Use a kernel port.",
};

export default tseslint.config(
  {
    ignores: ["**/dist/**", "**/coverage/**", "**/.turbo/**", "**/node_modules/**"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/consistent-type-imports": ["error", { prefer: "type-imports" }],
      "no-restricted-globals": [
        "error",
        {
          name: "process",
          message: "Config comes through validated module config, not ad-hoc process.env reads.",
        },
      ],
    },
  },
  {
    // Production source: no console — the Logger port exists for a reason.
    files: ["packages/*/src/**"],
    rules: {
      "no-console": "error",
    },
  },
  {
    // domain: innermost layer. Imports kernel types and itself only.
    files: ["packages/*/src/domain/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/application/**", "**/infrastructure/**", "**/interface/**"],
              message: "The dependency rule: domain must not import outer layers.",
            },
            noNodeBuiltins,
          ],
        },
      ],
    },
  },
  {
    // application: may import domain + kernel. Never adapters or transport.
    files: ["packages/*/src/application/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/infrastructure/**", "**/interface/**"],
              message:
                "The dependency rule: application must not import infrastructure or interface.",
            },
            noNodeBuiltins,
          ],
        },
      ],
    },
  },
  {
    // interface: translates transport → use cases; never touches adapters directly.
    files: ["packages/*/src/interface/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/infrastructure/**"],
              message: "Interface bindings depend on application ports, not concrete adapters.",
            },
          ],
        },
      ],
    },
  },
  {
    // Tests and tooling may use Node APIs and console freely.
    files: ["**/test/**", "tooling/**", "apps/**"],
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      "no-console": "off",
      "no-restricted-globals": "off",
    },
  },
);
