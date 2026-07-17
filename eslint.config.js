import js from "@eslint/js";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";

// Correctness-focused, not style — there's no prettier/formatting config in
// this repo, so rules here catch real bugs (unused vars, undefined globals,
// broken hooks deps) rather than bikeshedding quotes or semicolons.
export default [
  {
    ignores: [
      "**/node_modules/**",
      "packages/dashboard/dist/**",
      "packages/cli/dashboard-dist/**",
      ".ouro/**",
    ],
  },
  js.configs.recommended,
  {
    rules: {
      // `const { known, ...rest } = obj` to strip a key on purpose is a normal
      // idiom in this codebase (see server/index.js's telegram-disconnect
      // route) — the recommended rule flags `known` as unused, which it isn't.
      "no-unused-vars": ["error", { ignoreRestSiblings: true }],
    },
  },
  {
    files: ["packages/cli/**/*.js", "scripts/**/*.js", "eslint.config.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: { ...globals.node },
    },
  },
  {
    files: ["packages/dashboard/**/*.{js,jsx}"],
    plugins: { react, "react-hooks": reactHooks },
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: { ...globals.browser },
    },
    rules: {
      ...react.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      "react/react-in-jsx-scope": "off", // Vite's JSX runtime doesn't need it in scope
      "react/prop-types": "off", // no prop-types in this codebase, not worth requiring
      "react/no-unescaped-entities": "off", // a literal apostrophe in JSX text isn't a bug
    },
    settings: { react: { version: "detect" } },
  },
];
