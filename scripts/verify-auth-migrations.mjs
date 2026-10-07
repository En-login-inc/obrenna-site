import assert from 'node:assert/strict';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { applyMigrations } from './migration-runner.mjs';

const { Client } = pg;
const execFileAsync = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const adminUrl = process.env.MIGRATION_TEST_ADMIN_URL;
if (!adminUrl) {
  throw new Error('Set MIGRATION_TEST_ADMIN_URL to a disposable PostgreSQL admin database URL');
}

const suffix = randomUUID().replaceAll('-', '');
const databaseNames = [
  `obrenna_migration_fresh_${suffix}`,
  `obrenna_migration_upgrade_${suffix}`,
  `obrenna_migration_restore_${suffix}`,
];
const admin = new Client({ connectionString: adminUrl, application_name: 'obrenna-migration-integration-test' });
let adminConnected = false;

function databaseUrl(name) {
  const url = new URL(adminUrl);
  url.pathname = `/${name}`;
  return url.toString();
}

async function createDatabase(name) {
  // Names contain only a fixed prefix and a generated hexadecimal UUID.
  await admin.query(`CREATE DATABASE "${name}"`);
}

async function verifyDatabase(name, upgrade) {
  const client = new Client({ connectionString: databaseUrl(name), application_name: 'obrenna-migration-verification' });
  await client.connect();
  try {
    await client.query(await readFile(resolve(root, 'server-db/auth-schema-postgres.sql'), 'utf8'));
    if (upgrade) {
      await client.query(await readFile(resolve(root, 'server-db/fixtures/auth-schema-pre-migration.sql'), 'utf8'));
    }

    const migrationsDirectory = resolve(root, 'server-db/migrations');
    await applyMigrations(client, migrationsDirectory, { log: (message) => console.log(`${name}: ${message}`) });
    await applyMigrations(client, migrationsDirectory, { log: (message) => console.log(`${name}: ${message}`) });

    const result = await client.query(
      `SELECT
         (SELECT count(*) FROM schema_migrations) AS migration_count,
         EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = current_schema() AND table_name = 'organizations'
                   AND column_name = 'policy_revision') AS has_policy_revision,
         to_regclass('idx_desktop_auth_devices_user_org_key') IS NOT NULL AS has_scoped_device_key,
         NOT EXISTS (SELECT 1 FROM pg_constraint
                     WHERE conname = 'desktop_auth_devices_device_key_key') AS removed_global_device_key,
         (SELECT count(*) FROM desktop_auth_devices) AS device_count,
         (SELECT count(*) FROM users) AS user_count,
         (SELECT count(*) FROM organization_memberships) AS membership_count`,
    );
    assert.deepEqual(result.rows[0], {
      migration_count: '1',
      has_policy_revision: true,
      has_scoped_device_key: true,
      removed_global_device_key: true,
      device_count: upgrade ? '1' : '0',
      user_count: upgrade ? '1' : '0',
      membership_count: upgrade ? '1' : '0',
    });
  } finally {
    await client.end();
  }
}

async function verifyBackupRestore(sourceName, restoredName, backupDirectory) {
  const backupPath = resolve(backupDirectory, 'auth-database.dump');
  const sourceUrl = new URL(databaseUrl(sourceName));
  const restoredUrl = new URL(databaseUrl(restoredName));
  const pgEnvironment = {
    ...process.env,
    // Keep database credentials out of process arguments. libpq reads these
    // standard environment variables for both pg_dump and pg_restore.
    PGHOST: sourceUrl.hostname,
    PGPORT: sourceUrl.port || '5432',
    PGUSER: decodeURIComponent(sourceUrl.username),
    PGPASSWORD: decodeURIComponent(sourceUrl.password),
    PGSSLMODE: sourceUrl.searchParams.get('sslmode') || process.env.PGSSLMODE || 'prefer',
  };
  sourceUrl.username = '';
  sourceUrl.password = '';
  sourceUrl.search = '';
  restoredUrl.username = '';
  restoredUrl.password = '';
  restoredUrl.search = '';

  await execFileAsync('pg_dump', [
    '--format=custom', '--no-owner', '--no-privileges', '--file', backupPath,
    '--dbname', sourceUrl.toString(),
  ], { env: pgEnvironment, windowsHide: true });

  await execFileAsync('pg_restore', [
    '--no-owner', '--no-privileges', '--exit-on-error', '--single-transaction',
    '--dbname', restoredUrl.toString(), backupPath,
  ], { env: pgEnvironment, windowsHide: true });

  const restored = new Client({
    connectionString: databaseUrl(restoredName),
    application_name: 'obrenna-backup-restore-verification',
  });
  await restored.connect();
  try {
    const result = await restored.query(
      `SELECT
         (SELECT count(*) FROM schema_migrations) AS migration_count,
         (SELECT count(*) FROM users) AS user_count,
         (SELECT count(*) FROM organization_memberships) AS membership_count,
         (SELECT count(*) FROM desktop_auth_devices) AS device_count,
         EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = current_schema() AND table_name = 'organizations'
                   AND column_name = 'policy_revision') AS has_policy_revision`,
    );
    assert.deepEqual(result.rows[0], {
      migration_count: '1',
      user_count: '1',
      membership_count: '1',
      device_count: '1',
      has_policy_revision: true,
    });
  } finally {
    await restored.end();
  }
}

let backupDirectory;
try {
  await admin.connect();
  adminConnected = true;
  for (const name of databaseNames) await createDatabase(name);
  await verifyDatabase(databaseNames[0], false);
  await verifyDatabase(databaseNames[1], true);
  backupDirectory = await mkdtemp(resolve(tmpdir(), 'obrenna-auth-backup-'));
  await verifyBackupRestore(databaseNames[1], databaseNames[2], backupDirectory);
  console.log('Fresh-install, pre-migration upgrade, and PostgreSQL backup/restore checks passed.');
} finally {
  try {
    if (adminConnected) {
      for (const name of databaseNames) {
        await admin.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1', [name]);
        await admin.query(`DROP DATABASE IF EXISTS "${name}"`);
      }
    }
  } finally {
    if (adminConnected) await admin.end();
    if (backupDirectory) await rm(backupDirectory, { recursive: true, force: true });
  }
}
