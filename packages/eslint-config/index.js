/** @type {import("eslint").Linter.Config} */
module.exports = {
  parser: "@typescript-eslint/parser",
  extends: [
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended",
    "plugin:@typescript-eslint/recommended-requiring-type-checking",
  ],
  plugins: ["@typescript-eslint"],
  rules: {
    // Enforce explicit return types on exported functions
    "@typescript-eslint/explicit-module-boundary-types": "warn",
    // Prefer const where variable is never reassigned
    "prefer-const": "error",
    // Disallow console.log in production code (use Pino logger)
    "no-console": ["warn", { allow: ["error", "warn"] }],
    // Require await on async functions that return promises
    "@typescript-eslint/no-floating-promises": "error",
    // Disallow non-null assertions
    "@typescript-eslint/no-non-null-assertion": "warn",
    // Disallow unused variables (except _ prefixed)
    "@typescript-eslint/no-unused-vars": [
      "error",
      { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
    ],
    // No explicit any
    "@typescript-eslint/no-explicit-any": "error",
  },
  env: {
    node: true,
    es2022: true,
  },
};
