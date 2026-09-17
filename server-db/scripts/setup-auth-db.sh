#!/usr/bin/env bash

# Bootstrap script for local Docker Postgres setup
# Starts Postgres and loads the auth schema. Safe to re-run.

set -euo pipefail

# Paths resolve from the script location, not the caller's working directory.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DB_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

COMPOSE_FILE="$DB_DIR/docker-compose.auth.yml"
SCHEMA_FILE="$DB_DIR/auth-schema-postgres.sql"
SERVICE="postgres-auth"
DB_USER="obrenna"
DB_NAME="obrenna-server-db"

if ! command -v docker > /dev/null 2>&1; then
  echo "docker not found on PATH. Install Docker Desktop and retry." >&2
  exit 1
fi

if docker compose version > /dev/null 2>&1; then
  compose() { docker compose -f "$COMPOSE_FILE" "$@"; }
elif command -v docker-compose > /dev/null 2>&1; then
  compose() { docker-compose -f "$COMPOSE_FILE" "$@"; }
else
  echo "Neither 'docker compose' nor 'docker-compose' is available." >&2
  exit 1
fi

for f in "$COMPOSE_FILE" "$SCHEMA_FILE"; do
  if [ ! -f "$f" ]; then
    echo "Missing required file: $f" >&2
    exit 1
  fi
done

echo "Starting Postgres container..."
compose up -d "$SERVICE"

echo "Waiting for Postgres to accept connections..."
ready=0
for _ in $(seq 1 60); do
  if compose exec -T "$SERVICE" pg_isready -U "$DB_USER" -d "$DB_NAME" > /dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 1
done

if [ "$ready" -ne 1 ]; then
  echo "Postgres did not become ready in 60s. Recent logs:" >&2
  compose logs --tail 50 "$SERVICE" >&2
  exit 1
fi

echo "Applying schema..."
compose exec -T "$SERVICE" psql -v ON_ERROR_STOP=1 -U "$DB_USER" -d "$DB_NAME" < "$SCHEMA_FILE"

echo "Tables:"
compose exec -T "$SERVICE" psql -U "$DB_USER" -d "$DB_NAME" -c '\dt'

echo "Auth database ready: postgresql://$DB_USER:obrenna@localhost:5432/$DB_NAME"
