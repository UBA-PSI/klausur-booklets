import js from "@eslint/js";
import globals from "globals";

export default [
  js.configs.recommended, // Use ESLint recommended rules
  {
    languageOptions: {
      ecmaVersion: "latest", // Support latest JS features
      sourceType: "module", // Assume ES modules
      globals: {
        ...globals.browser, // Define browser environment globals
        ...globals.node     // Define Node.js environment globals
        // CommonJS and ES2021 are generally covered by node env and ecmaVersion: latest
      }
    },
    rules: {
      // Custom rules from the old .eslintrc.js
      "indent": ["error", 4],
      "linebreak-style": ["error", "unix"],
      "quotes": ["error", "single", { "allowTemplateLiterals": true }],
      "semi": ["error", "always"],
      "no-unused-vars": ["warn"]
    },
    // By default, ESLint v9 lints JS, MJS, CJS. If you need to lint other files
    // or specific directories, you might add `files` or `ignores` keys here.
    // Example:
    // files: ["src/**/*.js"],
    // ignores: ["node_modules/", "dist/"]
  }
]; 