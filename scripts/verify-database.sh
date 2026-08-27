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
    -f migrations/0005_audit_log_immutability.sql \
    -f seeds/demo.sql >/dev/null
done

# 監査ログの追記専用保護(0005)が実際に効いていることを確認する。
# UPDATE/DELETEが成功してしまう場合はmigration適用漏れやトリガー欠落なので検証失敗とする。
probe_id="audit_trigger_verify_probe"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -Atc "
  insert into audit_logs (id, actor_id, action, target_type, target_id, detail)
  values ('$probe_id', 'verify', 'probe.insert', 'test', 'x', '{}'::jsonb)
  on conflict (id) do nothing
" >/dev/null

trigger_count="$(psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -Atc "
  select count(*) from pg_trigger
  where tgrelid = 'audit_logs'::regclass and not tgisinternal and tgname like 'audit_logs_no_%'
")"
if [[ "$trigger_count" != "2" ]]; then
  echo "database verification failed: audit_logs append-only triggers missing (found=$trigger_count)" >&2
  exit 1
fi

if psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "update audit_logs set detail = '{}'::jsonb where id = '$probe_id'" >/dev/null 2>&1; then
  echo "database verification failed: audit_logs UPDATE was not rejected" >&2
  exit 1
fi
if psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "delete from audit_logs where id = '$probe_id'" >/dev/null 2>&1; then
  echo "database verification failed: audit_logs DELETE was not rejected" >&2
  exit 1
fi
# 検証用probe行はトリガーにより削除できないため、検証DBではそのまま残る(次回適用時の重複を避ける)。
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -Atc "
  delete from audit_logs where id = '$probe_id' and false
" >/dev/null

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
