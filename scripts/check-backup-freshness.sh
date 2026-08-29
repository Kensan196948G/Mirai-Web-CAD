#!/usr/bin/env bash
# 最新バックアップが一定時間以内かつ0バイト超であることを検証する。
# バックアップが止まった場合に気づけるようにする(GitHub Actions runnerが
# ローカルDBへ到達できないため、この検証もローカルで完結させる必要がある)。
# systemd timer (deploy/systemd/mirai-web-cad-backup-check.timer) から実行される。
set -euo pipefail

backup_dir="${BACKUP_DIR:-artifacts/backups}"
max_age_hours="${MAX_AGE_HOURS:-36}"
latest="${backup_dir}/latest.dump"

if [[ ! -e "$latest" ]]; then
  echo "backup freshness check FAILED: no backup found at $latest" >&2
  exit 1
fi

target="$(readlink -f "$latest")"
if [[ ! -s "$target" ]]; then
  echo "backup freshness check FAILED: backup file is empty: $target" >&2
  exit 1
fi

now_epoch="$(date +%s)"
mtime_epoch="$(stat -c %Y "$target")"
age_hours=$(( (now_epoch - mtime_epoch) / 3600 ))

if (( age_hours > max_age_hours )); then
  echo "backup freshness check FAILED: latest backup is ${age_hours}h old (max ${max_age_hours}h): $target" >&2
  exit 1
fi

echo "backup freshness check ok: ${target} (${age_hours}h old, $(stat -c %s "$target") bytes)"
