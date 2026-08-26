#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "DATABASE_URL is required" >&2
  exit 2
fi

for pass in 1 2; do
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -1 \
    -f migrations/0001_initial.sql \
    -f migrations/0002_idempotency.sql \
    -f migrations/0003_drawing_revision.sql \
    -f migrations/0004_drawing_visibility.sql \
    -f seeds/demo.sql >/dev/null
done

verification="$({
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -Atc "
    select concat_ws(':',
      current_database(),
      (select count(*) from information_schema.tables where table_schema = 'public'),
      (select count(*) from projects where id = 'prj_demo_road_001'),
      (select count(*) from drawings where id = 'dwg_demo_001'),
      (select count(*) from drawings where id = 'dwg_demo_001' and visibility = 'public'),
      (select count(*) from drawing_versions where id = 'ver_demo_001_001'),
      (select count(*) from audit_logs where id = 'audit_seed_demo_001')
    )
  "
})"

IFS=: read -r database table_count project_count drawing_count public_count version_count audit_count <<<"$verification"

if [[ "$table_count" != "8" || "$project_count" != "1" || "$drawing_count" != "1" || "$public_count" != "1" || "$version_count" != "1" || "$audit_count" != "1" ]]; then
  echo "database verification failed: tables=$table_count project=$project_count drawing=$drawing_count public=$public_count version=$version_count audit=$audit_count" >&2
  exit 1
fi

echo "database verification ok: database=$database tables=$table_count seed=1"
