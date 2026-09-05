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

if [[ -n "${SOURCE_DATABASE_URL:-}" ]]; then
  source_database="$("$pg_bin/psql" "$SOURCE_DATABASE_URL" -v ON_ERROR_STOP=1 -Atqc 'select current_database()')"
  restore_database="$("$pg_bin/psql" "$RESTORE_DATABASE_URL" -v ON_ERROR_STOP=1 -Atqc 'select current_database()')"
  if [[ "$source_database" == "$restore_database" ]]; then
    echo "Recovery database must differ from source database: ${source_database}" >&2
    exit 4
  fi
fi

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

invalid_json="$("${pg_bin}/psql" "$RESTORE_DATABASE_URL" -v ON_ERROR_STOP=1 -At -F ':' -c "
  select
    (select count(*) from drawing_versions where jsonb_typeof(content) <> 'object'),
    (select count(*) from command_events where jsonb_typeof(command_payload) not in ('object', 'array')),
    (select count(*) from agent_runs where proposal is not null and jsonb_typeof(proposal) not in ('object', 'array')),
    (select count(*) from audit_logs where jsonb_typeof(detail) <> 'object')
")"
IFS=: read -r invalid_content invalid_commands invalid_proposals invalid_audits <<<"$invalid_json"
if (( invalid_content + invalid_commands + invalid_proposals + invalid_audits != 0 )); then
  echo "recovery verification failed: invalid JSONB shapes content=$invalid_content commands=$invalid_commands proposals=$invalid_proposals audits=$invalid_audits" >&2
  exit 1
fi

version_mismatches="$("${pg_bin}/psql" "$RESTORE_DATABASE_URL" -v ON_ERROR_STOP=1 -Atc "
  select count(*)
  from drawings d
  where d.current_version is distinct from (
    select max(v.version_no) from drawing_versions v where v.drawing_id = d.id
  )
")"
if [[ "$version_mismatches" != "0" ]]; then
  echo "recovery verification failed: drawings not pointing to latest version=$version_mismatches" >&2
  exit 1
fi

database_signature() {
  "$pg_bin/psql" "$1" -v ON_ERROR_STOP=1 -At -F '|' -c "
    select
      (select count(*) from projects),
      (select count(*) from drawings),
      (select count(*) from drawing_versions),
      (select count(*) from audit_logs),
      coalesce((
        select md5(string_agg(
          concat_ws(':', d.id, d.current_version, v.version_no, v.content_hash),
          E'\\n' order by d.id
        ))
        from drawings d
        join drawing_versions v
          on v.drawing_id = d.id and v.version_no = d.current_version
      ), md5(''))
  "
}

if [[ -n "${SOURCE_DATABASE_URL:-}" ]]; then
  source_signature="$(database_signature "$SOURCE_DATABASE_URL")"
  restored_signature="$(database_signature "$RESTORE_DATABASE_URL")"
  if [[ "$source_signature" != "$restored_signature" ]]; then
    echo "recovery verification failed: source/restored four-table counts or latest drawing versions differ" >&2
    echo "source=${source_signature} restored=${restored_signature}" >&2
    exit 1
  fi
fi

source_match="no (source comparison skipped)"
if [[ -n "${SOURCE_DATABASE_URL:-}" ]]; then
  source_match="yes"
fi
echo "database recovery verified: projects=$projects drawings=$drawings versions=$versions audits=$audits invalid_json=0 latest_version_mismatches=0 source_match=$source_match"
