module.exports = {
  root: true,
  parser: "@typescript-eslint/parser",
  plugins: ["@typescript-eslint", "react-hooks"],
  extends: ["eslint:recommended", "plugin:@typescript-eslint/recommended"],
  env: { es2022: true, node: true, browser: true },
  ignorePatterns: [
    "dist/**",
    "node_modules/**",
    "*.d.ts",
    "coverage/**",
    "release/**",
    "supabase/.temp/**"
  ],
  rules: {
    "@typescript-eslint/no-unused-vars": [
      "error",
      { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }
    ],
    "@typescript-eslint/no-explicit-any": "warn",
    "no-empty": ["error", { allowEmptyCatch: false }],
    "no-console": ["warn", { allow: ["warn", "error"] }],
    "react-hooks/rules-of-hooks": "error",
    "react-hooks/exhaustive-deps": "warn"
  },
  overrides: [
    {
      // Electron main process and Node tooling may use console.
      files: ["apps/desktop/src/main/**", "*.config.*", "*.cjs", "**/scripts/**"],
      rules: { "no-console": "off" }
    }
  ]
};
