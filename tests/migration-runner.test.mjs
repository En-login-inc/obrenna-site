import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { applyMigrations } from '../scripts/migration-runner.mjs';

class FakeMigrationClient {
  constructor() {
    this.applied = new Map();
    this.queries = [];
    this.executedMigrations = [];
    this.failOn = null;
  }

  async query(sql, values = []) {
    this.queries.push({ sql, values });
    if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [], rowCount: 0 };
    if (sql.startsWith('SELECT pg_advisory_xact_lock')) return { rows: [], rowCount: 1 };
    if (sql.startsWith('SELECT checksum FROM schema_migrations')) {
      const checksum = this.applied.get(values[0]);
      return checksum ? { rows: [{ checksum }], rowCount: 1 } : { rows: [], rowCount: 0 };
    }
    if (sql.startsWith('INSERT INTO schema_migrations')) {
      this.applied.set(values[0], values[1]);
      return { rows: [], rowCount: 1 };
    }
    if (sql.trimStart().startsWith('CREATE TABLE IF NOT EXISTS schema_migrations')) return { rows: [], rowCount: 0 };
    if (sql === this.failOn) throw new Error('simulated migration failure');
    this.executedMigrations.push(sql);
    return { rows: [], rowCount: 0 };
  }
}

async function withMigrationDirectory(run) {
  const directory = await mkdtemp(join(tmpdir(), 'obrenna-migrations-'));
  try {
    await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test('migrations run in numeric filename order and record their checksums', async () => {
  await withMigrationDirectory(async (directory) => {
    await writeFile(join(directory, '002_second.sql'), 'SELECT 2;');
    await writeFile(join(directory, '001_first.sql'), 'SELECT 1;');
    await writeFile(join(directory, 'README.md'), 'ignored');
    const client = new FakeMigrationClient();

    await applyMigrations(client, directory);

    assert.deepEqual(client.executedMigrations, ['SELECT 1;', 'SELECT 2;']);
    assert.deepEqual([...client.applied.keys()], ['001_first.sql', '002_second.sql']);
    assert.equal(client.queries.filter(({ sql }) => sql.startsWith('SELECT pg_advisory_xact_lock')).length, 2);
  });
});

test('an already applied migration cannot be silently modified', async () => {
  await withMigrationDirectory(async (directory) => {
    const path = join(directory, '001_first.sql');
    await writeFile(path, 'SELECT 1;');
    const client = new FakeMigrationClient();
    await applyMigrations(client, directory);
    await writeFile(path, 'SELECT 2;');

    await assert.rejects(() => applyMigrations(client, directory), /was modified/);
    assert.equal(client.queries.at(-1)?.sql, 'ROLLBACK');
  });
});

test('a failed SQL migration rolls back before escaping', async () => {
  await withMigrationDirectory(async (directory) => {
    const migration = 'CREATE TABLE broken (id INT);';
    await writeFile(join(directory, '001_broken.sql'), migration);
    const client = new FakeMigrationClient();
    client.failOn = migration;

    await assert.rejects(() => applyMigrations(client, directory), /simulated migration failure/);
    assert.equal(client.applied.size, 0);
    assert.equal(client.queries.at(-1)?.sql, 'ROLLBACK');
  });
});
