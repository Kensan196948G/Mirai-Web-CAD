#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "DATABASE_URL is required" >&2
  exit 2
fi

backup_file="${BACKUP_FILE:-artifacts/mirai-web-cad.dump}"
manifest_file="${BACKUP_MANIFEST_FILE:-${backup_file}.manifest}"
pg_bin="${PG_BIN:-$(pg_config --bindir)}"
mkdir -p "$(dirname "$backup_file")"
umask 077

signature_before="$(DATABASE_SIGNATURE_URL="$DATABASE_URL" PG_BIN="$pg_bin" bash "$(dirname "$0")/database-signature.sh")"

"$pg_bin/pg_dump" "$DATABASE_URL" \
  --format=custom \
  --no-owner \
  --no-privileges \
  --file="$backup_file"

"$pg_bin/pg_restore" --list "$backup_file" >/dev/null
signature_after="$(DATABASE_SIGNATURE_URL="$DATABASE_URL" PG_BIN="$pg_bin" bash "$(dirname "$0")/database-signature.sh")"
if [[ "$signature_before" != "$signature_after" ]]; then
  rm -f "$backup_file" "$manifest_file"
  echo "database backup failed: source changed while the archive was created; retry" >&2
  exit 1
fi

archive_sha256="$(sha256sum "$backup_file" | awk '{print $1}')"
created_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
printf '%s\n' \
  'format=mirai-web-cad-backup-manifest-v1' \
  "created_at=${created_at}" \
  "sha256=${archive_sha256}" \
  "signature=${signature_before}" >"$manifest_file"

echo "database backup verified: $backup_file manifest=$manifest_file"
