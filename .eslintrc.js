module.exports = {
  env: {
    es6: true,
    browser: true,
    node: true
  },
  globals: {
    wx: 'readonly',
    cloud: 'readonly',
    Page: 'readonly',
    Component: 'readonly',
    getApp: 'readonly'
  },
  extends: 'eslint:recommended',
  parserOptions: {
    ecmaVersion: 2018,
    sourceType: 'module'
  },
  rules: {
    'no-console': 'off',
    'no-unused-vars': ['warn', { 'args': 'none' }],
    'semi': ['error', 'always'],
    'quotes': ['error', 'single']
  }
};
