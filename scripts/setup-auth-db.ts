#!/usr/bin/env node

/**
 * Bootstrap script to initialize the Postgres auth database with schema and sample data.
 * Run this after starting the Docker container:
 *   npm run setup:auth-db
 *
 * Environment variables:
 *   AUTH_DB_URL (default: postgresql://obrenna:obrenna@localhost:5432/obrenna-server-db)
 *   SKIP_SAMPLES (default: false - if 'true', only run schema, no sample data)
 */

import { Pool } from 'pg';
import { readFileSync } from 'fs';
import { join } from 'path';

const AUTH_DB_URL = process.env.AUTH_DB_URL ?? 'postgresql://obrenna:obrenna@localhost:5432/obrenna-server-db';
const SKIP_SAMPLES = process.env.SKIP_SAMPLES === 'true';

const pool = new Pool({
  connectionString: AUTH_DB_URL,
  max: 1,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

async function runSetup() {
  const client = await pool.connect();

  try {
    console.log('🚀 Initializing Postgres auth database...');

    // Read schema from SQL file
    const schemaPath = join(process.cwd(), '..', 'auth-schema-postgres.sql');
    let schema: string;
    try {
      schema = readFileSync(schemaPath, 'utf-8');
    } catch {
      console.error(`❌ Could not read schema file at ${schemaPath}`);
      console.log('   Falling back to inline schema...');
      schema = getInlineSchema();
    }

    // Split by semicolon and execute each statement
    const statements = schema.split(';').filter((s) => s.trim());

    for (const statement of statements) {
      if (statement.trim()) {
        try {
          await client.query(statement);
        } catch (error) {
          console.warn(`⚠️  Schema statement failed (may be idempotent):`, (error as Error).message.slice(0, 100));
        }
      }
    }

    console.log('✅ Schema initialized.');

    // Optional: seed sample data
    if (!SKIP_SAMPLES) {
      console.log('📝 Seeding sample data...');
      await seedSampleData(client);
      console.log('✅ Sample data seeded.');
    }

    console.log('✨ Auth database ready!');
  } catch (error) {
    console.error('❌ Setup failed:', error);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

async function seedSampleData(client: any) {
  // Seed sample plan
  await client.query(
    `INSERT INTO plans (id, code, name, price_cents, currency, interval, features, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT DO NOTHING`,
    [
      '00000000-0000-0000-0000-000000000001',
      'starter',
      'Starter',
      2999, // $29.99
      'USD',
      'month',
      JSON.stringify({ users: 5, machines: 3, support: 'email' }),
      'active',
    ],
  );

  await client.query(
    `INSERT INTO plans (id, code, name, price_cents, currency, interval, features, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT DO NOTHING`,
    [
      '00000000-0000-0000-0000-000000000002',
      'pro',
      'Pro',
      9999, // $99.99
      'USD',
      'month',
      JSON.stringify({ users: 100, machines: 50, support: 'priority' }),
      'active',
    ],
  );

  console.log('  ✓ Created starter and pro plans');
}

function getInlineSchema(): string {
  return `\nCREATE EXTENSION IF NOT EXISTS pgcrypto;\n\nCREATE TABLE IF NOT EXISTS users (\n    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),\n    email VARCHAR(255) NOT NULL UNIQUE,\n    full_name VARCHAR(255) NOT NULL,\n    password_hash VARCHAR(512) NOT NULL,\n    status VARCHAR(32) NOT NULL DEFAULT 'active',\n    email_verified_at TIMESTAMPTZ,\n    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),\n    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()\n);\n\nCREATE TABLE IF NOT EXISTS organizations (\n    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),\n    name VARCHAR(255) NOT NULL,\n    slug VARCHAR(120) NOT NULL UNIQUE,\n    status VARCHAR(32) NOT NULL DEFAULT 'active',\n    metadata JSONB NOT NULL DEFAULT '{}',\n    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),\n    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()\n);\n\nCREATE TABLE IF NOT EXISTS organization_memberships (\n    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),\n    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,\n    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,\n    role VARCHAR(32) NOT NULL DEFAULT 'member',\n    status VARCHAR(32) NOT NULL DEFAULT 'active',\n    invited_by UUID REFERENCES users(id),\n    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),\n    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),\n    UNIQUE (user_id, organization_id)\n);\n\nCREATE TABLE IF NOT EXISTS plans (\n    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),\n    code VARCHAR(64) NOT NULL UNIQUE,\n    name VARCHAR(255) NOT NULL,\n    price_cents INTEGER NOT NULL,\n    currency CHAR(3) NOT NULL DEFAULT 'USD',\n    interval VARCHAR(32) NOT NULL DEFAULT 'month',\n    features JSONB NOT NULL DEFAULT '{}',\n    status VARCHAR(32) NOT NULL DEFAULT 'active',\n    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),\n    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()\n);\n\nCREATE TABLE IF NOT EXISTS subscriptions (\n    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),\n    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,\n    plan_id UUID NOT NULL REFERENCES plans(id),\n    status VARCHAR(32) NOT NULL DEFAULT 'trialing',\n    current_period_start TIMESTAMPTZ NOT NULL DEFAULT NOW(),\n    current_period_end TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '30 days',\n    cancel_at TIMESTAMPTZ,\n    provider VARCHAR(64) NOT NULL DEFAULT 'stripe',\n    provider_customer_id VARCHAR(255),\n    provider_subscription_id VARCHAR(255),\n    metadata JSONB NOT NULL DEFAULT '{}',\n    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),\n    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()\n);\n\nCREATE TABLE IF NOT EXISTS billing_events (\n    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),\n    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,\n    event_type VARCHAR(64) NOT NULL,\n    provider VARCHAR(64) NOT NULL DEFAULT 'stripe',\n    provider_event_id VARCHAR(255),\n    payload JSONB NOT NULL DEFAULT '{}',\n    occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),\n    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()\n);\n\nCREATE TABLE IF NOT EXISTS auth_sessions (\n    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),\n    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,\n    session_token VARCHAR(255) NOT NULL UNIQUE,\n    status VARCHAR(32) NOT NULL DEFAULT 'active',\n    expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '30 days',\n    revoked_at TIMESTAMPTZ,\n    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),\n    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()\n);\n\nCREATE TABLE IF NOT EXISTS desktop_auth_devices (\n    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),\n    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,\n    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,\n    device_name VARCHAR(255) NOT NULL,\n    device_key VARCHAR(255) NOT NULL UNIQUE,\n    status VARCHAR(32) NOT NULL DEFAULT 'pending',\n    last_seen_at TIMESTAMPTZ,\n    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),\n    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()\n);\n\nCREATE INDEX IF NOT EXISTS idx_users_email ON users(email);\nCREATE INDEX IF NOT EXISTS idx_organization_memberships_user ON organization_memberships(user_id);\nCREATE INDEX IF NOT EXISTS idx_organization_memberships_org ON organization_memberships(organization_id);\nCREATE INDEX IF NOT EXISTS idx_auth_sessions_user ON auth_sessions(user_id);\nCREATE INDEX IF NOT EXISTS idx_auth_sessions_expires_at ON auth_sessions(expires_at);\nCREATE INDEX IF NOT EXISTS idx_billing_events_org ON billing_events(organization_id);\nCREATE INDEX IF NOT EXISTS idx_subscriptions_org ON subscriptions(organization_id);\n  `;\n}\n\nrunSetup().catch((error) => {\n  console.error('Fatal error:', error);\n  process.exit(1);\n});\n`;
