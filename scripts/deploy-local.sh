#!/usr/bin/env bash
# mainブランチの最新コミットをこのホストへ反映し、mirai-web-cad.serviceを
# 再起動する。GitHub Actions(クラウドhosted runner)からはこのローカル
# マシンへ直接到達できないため、当面は人間がこのスクリプトを手動実行する
# (docs/operations.md参照)。失敗時は直前のコミットへ自動ロールバックする。
set -euo pipefail
cd "$(dirname "$0")/.."

if [[ -n "$(git status --porcelain)" ]]; then
  echo "作業ツリーに未コミットの変更があります。中止します。" >&2
  git status --short >&2
  exit 1
fi

prev_sha="$(git rev-parse HEAD)"
echo "現在のHEAD: $prev_sha"

git fetch --prune origin
if ! git merge --ff-only origin/main; then
  echo "origin/mainへfast-forwardできません(ローカルに未pushの差分がある可能性)。中止します。" >&2
  exit 1
fi
new_sha="$(git rev-parse HEAD)"
echo "デプロイ対象: $new_sha"

rollback() {
  echo "デプロイに失敗しました。${prev_sha} へロールバックします。" >&2
  git checkout --quiet "$prev_sha"
  npm ci --silent
  npm run build --silent
  sudo systemctl restart mirai-web-cad.service
  echo "ロールバック完了: $prev_sha" >&2
  exit 1
}
trap rollback ERR

npm ci
npm run build

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "DATABASE_URLが設定されていません。~/.config/mirai-web-cad/production.envをsourceしてください。" >&2
  exit 1
fi
npm run db:verify

sudo systemctl restart mirai-web-cad.service

echo "health check待機中..."
ok=0
for _ in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:${PORT:-18812}/api/health" | grep -qE '"ok":[[:space:]]*true'; then
    ok=1
    break
  fi
  sleep 1
done

trap - ERR
if [[ "$ok" != "1" ]]; then
  rollback
fi

echo "デプロイ成功: $new_sha"
