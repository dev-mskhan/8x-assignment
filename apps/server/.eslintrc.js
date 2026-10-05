/** @type {import("eslint").Linter.Config} */
module.exports = {
  root: true,
  extends: ["@marketplace/eslint-config"],
  parserOptions: {
    project: "./tsconfig.json",
    tsconfigRootDir: __dirname,
  },
  rules: {
    // Allow any-casts in infrastructure code where needed for pg-boss / Fastify interop
    "@typescript-eslint/no-explicit-any": "warn",
    // Allow void operator for fire-and-forget promises
    "no-void": "off",
  },
};
