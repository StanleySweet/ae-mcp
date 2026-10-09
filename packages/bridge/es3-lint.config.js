export default [
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 3,
      sourceType: 'script',
    },
    linterOptions: {
      reportUnusedDisableDirectives: 'off',
    },
  },
];