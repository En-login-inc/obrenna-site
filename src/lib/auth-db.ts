import { Pool, type PoolClient } from 'pg';
import { authConfig } from './auth-config';

export async function withAuthDb<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  // Worker sockets belong to the request that opened them; never reuse a global pool.
  const pool = new Pool({
    connectionString: authConfig.authDbUrl,
    max: 1,
    connectionTimeoutMillis: 5000,
  });
  let client: PoolClient | undefined;
  try {
    client = await pool.connect();
    return await fn(client);
  } finally {
    client?.release();
    await pool.end();
  }
}

export async function pingAuthDb() {
  const result = await withAuthDb((client) => client.query('SELECT 1 as ok'));
  return result.rows[0]?.ok === 1;
}
