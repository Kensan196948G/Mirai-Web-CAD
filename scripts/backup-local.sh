#!/usr/bin/env bash
# ローカルPostgreSQL本番DBの日次バックアップ。systemd timer
# (deploy/systemd/mirai-web-cad-backup.timer)から実行される想定。
# 既存のscripts/backup-database.sh(DATABASE_URLに対してpg_dumpするだけの
# 汎用スクリプト。CI/E2Eからも使われる)は無変更で呼び出す。
set -euo pipefail

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "DATABASE_URL is required" >&2
  exit 2
fi

backup_dir="${BACKUP_DIR:-artifacts/backups}"
retention_days="${RETENTION_DAYS:-14}"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
backup_file="${backup_dir}/mirai-web-cad-${timestamp}.dump"

mkdir -p "$backup_dir"
umask 077

BACKUP_FILE="$backup_file" bash "$(dirname "$0")/backup-database.sh"

ln -sf "$(basename "$backup_file")" "${backup_dir}/latest.dump"

echo "pruning backups older than ${retention_days} days in ${backup_dir}"
find "$backup_dir" -maxdepth 1 -name 'mirai-web-cad-*.dump' -mtime "+${retention_days}" -print -delete

echo "backup-local ok: $backup_file"
