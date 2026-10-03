import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    exclude: ['dist/**', 'node_modules*/**'],
    fileParallelism: false,
    setupFiles: ['./tests/setup.ts'],
    testTimeout: 15_000,
  },
});
