import js from '@eslint/js';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';
import prettier from 'eslint-config-prettier';
import importPlugin from 'eslint-plugin-import';
import unicorn from 'eslint-plugin-unicorn';

export default [
  {
    ignores: [
      '**/dist',
      'coverage',
      '**/out',
      '**/spike/**/*.jsx',
      'packages/bridge/src/*.js',
      // Native Setup app: a .NET project. Its only .jsx/.js are generated copies
      // (staged bridge payload/loader under Resources/, plus bin/obj).
      'apps/installer/**',
    ],
  },
  js.configs.recommended,
  {
    files: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
      },
      globals: {
        console: 'readonly',
        process: 'readonly',
        document: 'readonly',
        window: 'readonly',
        HTMLElement: 'readonly',
        HTMLButtonElement: 'readonly',
        CustomEvent: 'readonly',
        Event: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        setTimeout: 'readonly',
        AbortController: 'readonly',
        AbortSignal: 'readonly',
        NodeJS: 'readonly',
      },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
      import: importPlugin,
      unicorn,
    },
    settings: {
      'import/resolver': {
        typescript: {
          project: ['./tsconfig.json'],
        },
      },
    },
    rules: {
      ...tsPlugin.configs.recommended.rules,
      ...importPlugin.configs.recommended.rules,
      'import/order': ['error', { alphabetize: { order: 'asc' } }],
      // The SDK uses wildcard subpath exports that eslint-import-resolver-typescript
      // cannot map; tsc resolves and typechecks these imports instead.
      'import/no-unresolved': ['error', { ignore: ['^@modelcontextprotocol/sdk/'] }],
      'unicorn/prevent-abbreviations': 'off',
    },
  },
  prettier,
];
