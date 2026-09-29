import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    api: 'apps/api/src/index.ts',
    migrate: 'apps/api/src/migrate-entry.ts',
    seed: 'apps/api/src/seed-entry.ts',
    bot: 'apps/bot/src/index.ts',
    worker: 'apps/worker/src/index.ts',
    'demo-smoke': 'scripts/demo-smoke.ts',
    'llm-smoke': 'scripts/llm-smoke.ts',
    'max-subscription': 'scripts/max-subscription.ts',
    'upload-intro-videos': 'scripts/upload-intro-videos.ts',
    'verify-knowledge-copy': 'scripts/verify-knowledge-copy.ts',
    'knowledge-release-smoke': 'scripts/knowledge-release-smoke.ts',
  },
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  splitting: true,
  minify: false,
});
