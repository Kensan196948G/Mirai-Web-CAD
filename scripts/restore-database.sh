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
manifest_file="${BACKUP_MANIFEST_FILE:-${BACKUP_FILE}.manifest}"
max_backup_age_hours="${MAX_BACKUP_AGE_HOURS:-24}"

if [[ ! -s "$manifest_file" ]]; then
  echo "Backup manifest is required: $manifest_file" >&2
  exit 4
fi

manifest_value() {
  awk -F= -v key="$1" '
    $1 == key { sub(/^[^=]*=/, ""); value=$0; found++ }
    END { if (found != 1) exit 1; print value }
  ' "$manifest_file"
}

manifest_format="$(manifest_value format)"
manifest_created_at="$(manifest_value created_at)"
manifest_sha256="$(manifest_value sha256)"
manifest_signature="$(manifest_value signature)"
if [[ "$manifest_format" != "mirai-web-cad-backup-manifest-v1" ]] ||
   [[ ! "$manifest_created_at" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$ ]] ||
   [[ ! "$manifest_sha256" =~ ^[0-9a-f]{64}$ ]] ||
   [[ ! "$manifest_signature" =~ ^[0-9]+\|[0-9]+\|[0-9]+\|[0-9]+\|[0-9a-f]{32}$ ]]; then
  echo "Backup manifest is malformed: $manifest_file" >&2
  exit 4
fi

actual_sha256="$(sha256sum "$BACKUP_FILE" | awk '{print $1}')"
if [[ "$actual_sha256" != "$manifest_sha256" ]]; then
  echo "Backup archive checksum does not match its manifest" >&2
  exit 4
fi

created_epoch="$(date -u -d "$manifest_created_at" +%s)"
age_seconds=$(( $(date -u +%s) - created_epoch ))
if (( age_seconds < 0 || age_seconds > max_backup_age_hours * 3600 )); then
  echo "Backup exceeds the ${max_backup_age_hours}h RPO limit: created_at=${manifest_created_at}" >&2
  exit 4
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
    (select count(*) from drawing_versions where content is null or jsonb_typeof(content) <> 'object'),
    (select count(*) from command_events where command_payload is null or jsonb_typeof(command_payload) not in ('object', 'array')),
    (select count(*) from agent_runs where proposal is not null and jsonb_typeof(proposal) not in ('object', 'array')),
    (select count(*) from audit_logs where detail is null or jsonb_typeof(detail) <> 'object')
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

restored_signature="$(DATABASE_SIGNATURE_URL="$RESTORE_DATABASE_URL" PG_BIN="$pg_bin" bash "$(dirname "$0")/database-signature.sh")"
if [[ "$manifest_signature" != "$restored_signature" ]]; then
  echo "recovery verification failed: restored four-table counts or latest drawing versions differ from backup manifest" >&2
  echo "manifest=${manifest_signature} restored=${restored_signature}" >&2
  exit 1
fi

echo "database recovery verified: projects=$projects drawings=$drawings versions=$versions audits=$audits invalid_json=0 latest_version_mismatches=0 manifest_match=yes backup_age_seconds=$age_seconds"
