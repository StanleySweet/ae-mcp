import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    globalSetup: ['./vitest.global-setup.ts'],
    // Agent worktrees under .claude/ hold full repo copies; never test them.
    exclude: ['**/node_modules/**', '**/dist/**', '.claude/**'],
    coverage: { reporter: ['text', 'lcov'] },
  },
});
