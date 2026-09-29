// A dedicated CLI entry survives code splitting; import.meta.url in a shared
// chunk cannot identify the entry script.
import { runSeed } from './seed.js';

runSeed().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'seed failed');
  process.exitCode = 1;
});
