module.exports = {
  "env": {
    "es6": true,
    "node": true
  },
  "extends": "eslint:recommended",
  "parserOptions": {
    "ecmaVersion": 2020,
"sourceType": "module",
        "allowImportExportEverywhere": true,
          },
  "globals": {
    "BigInt": true,
  },
  "rules": {
    "indent": 0,
    "linebreak-style": [
      "error",
      "unix"
    ],
    "semi": [
      "error",
      "always"
    ],
    "no-console": 0,
    "no-unused-expressions": ["error",{ allowShortCircuit: true }],
    "no-unused-vars": "warn",
    "no-shadow": ["warn", { "allow": ["done"] }],
  }
};
