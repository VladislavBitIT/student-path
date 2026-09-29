// A dedicated CLI entry survives code splitting; import.meta.url in a shared
// chunk cannot identify the entry script.
import { runMigrations } from './migrate.js';

runMigrations().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'migrate failed');
  process.exitCode = 1;
});
