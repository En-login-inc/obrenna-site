import { Pool } from 'pg';
import { authConfig } from './auth-config';

export const authPool = new Pool({
  connectionString: authConfig.authDbUrl,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

export async function withAuthDb<T>(fn: (client: import('pg').PoolClient) => Promise<T>): Promise<T> {
  const client = await authPool.connect();

  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

export async function pingAuthDb() {
  const result = await authPool.query('SELECT 1 as ok');
  return result.rows[0]?.ok === 1;
}
