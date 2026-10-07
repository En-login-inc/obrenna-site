import { dirname, resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { applyMigrations } from './migration-runner.mjs';

const { Pool } = pg;
const siteRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function readEnvValue(source, key) {
  const line = source.split(/\r?\n/).find((entry) => entry.trimStart().startsWith(`${key}=`));
  if (!line) return undefined;
  const value = line.slice(line.indexOf('=') + 1).trim();
  return value.replace(/^(['"])(.*)\1$/, '$2');
}

async function databaseUrl() {
  if (process.env.AUTH_DB_URL) return process.env.AUTH_DB_URL;
  for (const filename of ['.env.local', '.env']) {
    try {
      const fromFile = readEnvValue(await readFile(resolve(siteRoot, filename), 'utf8'), 'AUTH_DB_URL');
      if (fromFile) return fromFile;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  return 'postgresql://obrenna:obrenna@localhost:5432/obrenna-server-db';
}

async function applyConfiguredMigrations() {
  const pool = new Pool({ connectionString: await databaseUrl(), application_name: 'obrenna-auth-migrations' });
  const client = await pool.connect();
  try {
    const directory = resolve(siteRoot, 'server-db', 'migrations');
    await applyMigrations(client, directory, { log: console.log });
  } finally {
    client.release();
    await pool.end();
  }
}

applyConfiguredMigrations().catch((error) => {
  console.error(`Auth database migration failed: ${error.message}`);
  process.exitCode = 1;
});
