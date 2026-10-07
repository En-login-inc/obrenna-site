import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

/** Apply immutable, numbered PostgreSQL migrations through one checked-out client. */
export async function applyMigrations(client, directory, { log = () => {} } = {}) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      checksum CHAR(64) NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  const files = (await readdir(directory, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && /^\d+_[a-z0-9_-]+\.sql$/i.test(entry.name))
    .map((entry) => entry.name)
    .sort();

  for (const name of files) {
    const sql = await readFile(resolve(directory, name), 'utf8');
    const checksum = createHash('sha256').update(sql).digest('hex');
    await client.query('BEGIN');
    try {
      await client.query("SELECT pg_advisory_xact_lock(hashtext('obrenna:auth:schema_migrations'))");
      const prior = await client.query('SELECT checksum FROM schema_migrations WHERE name = $1', [name]);
      if (prior.rowCount) {
        if (prior.rows[0].checksum.trim() !== checksum) {
          throw new Error(`Applied migration ${name} was modified; add a new migration instead`);
        }
        await client.query('COMMIT');
        log(`Already applied ${name}`);
        continue;
      }

      log(`Applying ${name}`);
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)', [name, checksum]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  }
}
