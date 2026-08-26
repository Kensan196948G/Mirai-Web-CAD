#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${RESTORE_DATABASE_URL:-}" || -z "${BACKUP_FILE:-}" ]]; then
  echo "RESTORE_DATABASE_URL and BACKUP_FILE are required" >&2
  exit 2
fi

if [[ "${ALLOW_DATABASE_RESTORE:-}" != "yes" ]]; then
  echo "Set ALLOW_DATABASE_RESTORE=yes only for an empty recovery database" >&2
  exit 3
fi

pg_bin="${PG_BIN:-$(pg_config --bindir)}"

user_object_count="$("$pg_bin/psql" "$RESTORE_DATABASE_URL" -v ON_ERROR_STOP=1 -Atc "
  select count(*)
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname not in ('pg_catalog', 'information_schema')
    and n.nspname not like 'pg_toast%'
    and c.relkind in ('r', 'p', 'v', 'm', 'S', 'f')
")"
if [[ "$user_object_count" != "0" ]]; then
  echo "Recovery database must be empty: found $user_object_count user objects" >&2
  exit 4
fi

"$pg_bin/pg_restore" --dbname="$RESTORE_DATABASE_URL" \
  --exit-on-error \
  --no-owner \
  --no-privileges \
  "$BACKUP_FILE"

verification="$("$pg_bin/psql" "$RESTORE_DATABASE_URL" -v ON_ERROR_STOP=1 -Atc "
  select concat_ws(':',
    (select count(*) from projects),
    (select count(*) from drawings),
    (select count(*) from drawing_versions),
    (select count(*) from audit_logs)
  )
")"

IFS=: read -r projects drawings versions audits <<<"$verification"
if [[ "$projects" -lt 1 || "$drawings" -lt 1 || "$versions" -lt 1 || "$audits" -lt 1 ]]; then
  echo "recovery verification failed: $verification" >&2
  exit 1
fi

echo "database recovery verified: projects=$projects drawings=$drawings versions=$versions audits=$audits"
