#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${DATABASE_URL:-}" || -z "${RESTORE_DATABASE_URL:-}" ]]; then
  echo "DATABASE_URL and RESTORE_DATABASE_URL are required" >&2
  exit 2
fi

expected_restore_database="${EXPECTED_RESTORE_DATABASE:-mirai_web_cad_mvp_recovery}"
backup_dir="${BACKUP_DIR:-artifacts/backups}"
backup_file="${BACKUP_FILE:-${backup_dir}/latest.dump}"
pg_bin="${PG_BIN:-$(pg_config --bindir)}"

source_database="$("${pg_bin}/psql" "$DATABASE_URL" -Atqc 'select current_database()')"
restore_database="$("${pg_bin}/psql" "$RESTORE_DATABASE_URL" -Atqc 'select current_database()')"

if [[ "$restore_database" != "$expected_restore_database" || "$restore_database" == "$source_database" ]]; then
  echo "restore drill refused unsafe target: source=${source_database}, target=${restore_database}, expected=${expected_restore_database}" >&2
  exit 1
fi
if [[ ! -s "$backup_file" ]]; then
  echo "restore drill failed: backup not found or empty: $backup_file" >&2
  exit 1
fi

reset_recovery_database() {
  "${pg_bin}/psql" "$RESTORE_DATABASE_URL" -v ON_ERROR_STOP=1 \
    -c 'drop schema if exists public cascade; create schema public' >/dev/null
}
cleanup() {
  reset_recovery_database || echo "restore drill cleanup FAILED: ${restore_database}" >&2
}
trap cleanup EXIT

"${pg_bin}/pg_restore" --list "$backup_file" >/dev/null
reset_recovery_database

BACKUP_FILE="$backup_file" ALLOW_DATABASE_RESTORE=yes \
  bash "$(dirname "$0")/restore-database.sh"

json_string_count="$("${pg_bin}/psql" "$RESTORE_DATABASE_URL" -Atqc "
  select
    (select count(*) from drawing_versions where jsonb_typeof(content) = 'string') +
    (select count(*) from command_events where jsonb_typeof(command_payload) = 'string') +
    (select count(*) from agent_runs where jsonb_typeof(proposal) = 'string') +
    (select count(*) from audit_logs where jsonb_typeof(detail) = 'string')
")"
if [[ "$json_string_count" != "0" ]]; then
  echo "restore drill failed: JSONB string scalars remain (found=${json_string_count})" >&2
  exit 1
fi

echo "restore drill ok: source=${source_database}, recovery=${restore_database}, JSONB strings=0; recovery data will be cleared"
