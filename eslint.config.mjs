import tsPlugin from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";

export default [
  {
    files: ["packages/*/src/**/*.ts"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: "module",
      },
    },
    plugins: {
      "@typescript-eslint": tsPlugin,
    },
    rules: {
      ...tsPlugin.configs.recommended.rules,
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      // PERSIST-001 SI-002: concrete adapter implementations must only be imported from
      // the composition root (bin/directory.ts). Application code imports the interface only.
      // The composition root itself is excluded via the override below.
      "no-restricted-imports": ["error", {
        patterns: [
          {
            group: ["*/adapters/pg-directory-store*", "*/adapters/pg-directory-store.js"],
            message: "PgDirectoryStore may only be imported from the composition root (bin/directory.ts).",
          },
        ],
      }],
    },
  },
  // Composition root is the one permitted importer of concrete adapters
  {
    files: ["packages/directory/src/bin/directory.ts"],
    rules: {
      "no-restricted-imports": "off",
    },
  },
];
