#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "DATABASE_URL is required" >&2
  exit 2
fi

backup_file="${BACKUP_FILE:-artifacts/mirai-web-cad.dump}"
manifest_file="${BACKUP_MANIFEST_FILE:-${backup_file}.manifest}"
# クライアントはサーバと同じメジャー版を使う(新しい版のpg_dumpは古いサーバへ
# 復元できないdumpを作り得る)。未設定ならサーバ版から解決する。
pg_bin="${PG_BIN:-}"
if [[ -z "$pg_bin" ]]; then
  # shellcheck source=scripts/lib/pg-bin.sh
  source "$(dirname "$0")/lib/pg-bin.sh"
  if ! pg_bin="$(resolve_pg_bin "$DATABASE_URL")"; then
    exit 5
  fi
fi
mkdir -p "$(dirname "$backup_file")"
umask 077

# 対象DB名の検証(改善台帳P0-84)。本番用とMVP用はunitのEnvironmentFileとBACKUP_DIRだけが
# 異なるため、envの取り違えでMVPのdumpを本番バックアップとして保存しても検出できなかった。
# EXPECTED_DATABASEを設定した運用では、接続先が一致しなければ中止する。
backup_database_name="$(psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -Atc "select current_database()")"
if [[ -n "${EXPECTED_DATABASE:-}" && "$backup_database_name" != "$EXPECTED_DATABASE" ]]; then
  echo "database backup refused: connected to '${backup_database_name}' but EXPECTED_DATABASE='${EXPECTED_DATABASE}'" >&2
  exit 4
fi

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
  "signature=${signature_before}" \
  "database=${backup_database_name}" \
  "pg_client=$("$pg_bin/pg_dump" --version | awk '{print $3}')" >"$manifest_file"

echo "database backup verified: $backup_file manifest=$manifest_file"
