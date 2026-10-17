import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    globalSetup: ['./vitest.global-setup.ts'],
    // Parallel agent checks push the load average past 20; 5 s timeouts then fail at random.
    testTimeout: 20_000,
    // Agent worktrees under .claude/ hold full repo copies; never test them.
    exclude: ['**/node_modules/**', '**/dist/**', '.claude/**'],
    coverage: { reporter: ['text', 'lcov'] },
  },
});
