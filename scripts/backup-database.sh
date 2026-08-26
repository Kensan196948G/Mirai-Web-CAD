#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "DATABASE_URL is required" >&2
  exit 2
fi

backup_file="${BACKUP_FILE:-artifacts/mirai-web-cad.dump}"
pg_bin="${PG_BIN:-$(pg_config --bindir)}"
mkdir -p "$(dirname "$backup_file")"
umask 077

"$pg_bin/pg_dump" "$DATABASE_URL" \
  --format=custom \
  --no-owner \
  --no-privileges \
  --file="$backup_file"

"$pg_bin/pg_restore" --list "$backup_file" >/dev/null
echo "database backup verified: $backup_file"
