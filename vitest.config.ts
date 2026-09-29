import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@first30/config': resolve(import.meta.dirname, 'packages/config/src/index.ts'),
      '@first30/database': resolve(import.meta.dirname, 'packages/database/src/index.ts'),
      '@first30/domain': resolve(import.meta.dirname, 'packages/domain/src/index.ts'),
      '@first30/i18n': resolve(import.meta.dirname, 'packages/i18n/src/index.ts'),
      '@first30/max-adapter': resolve(import.meta.dirname, 'packages/max-adapter/src/index.ts'),
      '@first30/application': resolve(import.meta.dirname, 'packages/application/src/index.ts'),
    },
  },
  test: {
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    testTimeout: 20_000,
    hookTimeout: 30_000,
    pool: 'forks',
    sequence: { concurrent: false },
    coverage: { reporter: ['text', 'html'] },
  },
});
