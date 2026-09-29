import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema.js';

export type Database = NodePgDatabase<typeof schema>;

export interface DatabaseConnection {
  db: Database;
  pool: Pool;
  close: () => Promise<void>;
}

export function createDatabase(databaseUrl: string): DatabaseConnection {
  const pool = new Pool({
    connectionString: databaseUrl,
    max: 10,
    idleTimeoutMillis: 20_000,
    connectionTimeoutMillis: 5_000,
  });
  return {
    db: drizzle(pool, { schema }),
    pool,
    close: async () => pool.end(),
  };
}

export * from './schema.js';
