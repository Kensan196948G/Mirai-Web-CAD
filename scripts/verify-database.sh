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
    -f migrations/0006_normalize_jsonb_columns.sql \
    -f migrations/0007_project_membership.sql \
    -f migrations/0008_audit_truncate_guard.sql \
    -f seeds/demo.sql >/dev/null
done

# 監査ログの追記専用保護(0005)が実際に効いていることを確認する。
# UPDATE/DELETEが成功してしまう場合はmigration適用漏れやトリガー欠落なので検証失敗とする。
#
# 検査は必ずROLLBACKする単一トランザクション内で行い、検証行を一切コミットしない。
# 以前はprobe行をコミットしていたため、本番DBを対象に実行すると「トリガーにより
# 削除できない合成監査行」が本番の監査証跡へ恒久的に混入していた
# (2026-09-18ラウンドで mirai_web_cad への混入を実測確認。Issue #98参照)。
trigger_count="$(psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -Atc "
  select count(*) from pg_trigger
  where tgrelid = 'audit_logs'::regclass and not tgisinternal and tgname like 'audit_logs_no_%'
    and tgenabled = 'O'
")"
# UPDATE/DELETE(0005)に加えTRUNCATE拒否(0008)を含め3件であることを要求する。
if [[ "$trigger_count" != "3" ]]; then
  echo "database verification failed: audit_logs append-only triggers missing or disabled (found=$trigger_count, expected=3)" >&2
  exit 1
fi

if ! psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -f scripts/sql/verify-audit-append-only.sql >/dev/null; then
  echo "database verification failed: audit_logs append-only protection is not effective (UPDATE/DELETE were not rejected)" >&2
  exit 1
fi

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

# 期待テーブルは「名前」で検証する。件数の完全一致(!= 9)を要求すると、将来テーブルを
# 追加するmigrationを適用した時点で**全デプロイが恒久失敗**する(改善台帳P0-83)。
expected_tables_sql="array['agent_runs','audit_logs','command_events','drawing_versions','drawings','idempotency_keys','project_members','projects','reviews']"
missing_tables="$(psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -Atc "
  select coalesce(string_agg(t, ' '), '')
  from unnest(${expected_tables_sql}) as t
  where to_regclass('public.' || t) is null
")"
if [[ -n "$missing_tables" ]]; then
  echo "database verification failed: 期待テーブルがありません:${missing_tables}" >&2
  exit 1
fi

if [[ "$project_count" != "1" || "$drawing_count" != "1" || "$public_count" != "1" || "$version_count" != "1" || "$audit_count" != "1" ]]; then
  echo "database verification failed: tables=$table_count project=$project_count drawing=$drawing_count public=$public_count version=$version_count audit=$audit_count" >&2
  exit 1
fi

json_string_count="$(psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -Atc "
  select
    (select count(*) from drawing_versions where jsonb_typeof(content) = 'string') +
    (select count(*) from command_events where jsonb_typeof(command_payload) = 'string') +
    (select count(*) from agent_runs where jsonb_typeof(proposal) = 'string') +
    (select count(*) from audit_logs where jsonb_typeof(detail) = 'string')
")"
if [[ "$json_string_count" != "0" ]]; then
  echo "database verification failed: JSONB string scalars remain (found=$json_string_count)" >&2
  exit 1
fi

echo "database verification ok: database=$database tables=$table_count seed=1"
