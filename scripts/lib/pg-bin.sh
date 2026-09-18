#!/usr/bin/env bash
# PostgreSQLクライアントバイナリの解決。
#
# 背景(2026-09-18 第6ラウンドで実測):
#   このホストのサーバはPostgreSQL 16だが、PATH上の`pg_config --bindir`は
#   `/usr/lib/postgresql/18/bin`を指していた。`pg_dump`(18)は
#   `SET transaction_timeout = 0`(PG17以降のGUC)を出力するため、そのdumpを
#   PostgreSQL 16のサーバへ`pg_restore`すると
#   `unrecognized configuration parameter "transaction_timeout"` で失敗し、
#   **復元先DBが空のまま残る**。つまり「バックアップは成功するが復元できない」状態だった。
#   systemd unitは`PG_BIN=/usr/lib/postgresql/16/bin`を明示しているため定時バックアップは
#   影響を受けないが、README記載のドリル手順(`npm run db:backup`/`db:restore`)は
#   `PG_BIN`を設定しないため、この不整合を踏んでいた。修正後は同じ手順で復元まで成功する
#   (manifestに`pg_client=16.14`として使用版を記録する)。
#
# 方針: サーバのメジャー版と一致するクライアントを使う。一致するものが見つからない場合は
# 「黙って新しい版を使う」ことをせず、明示的に失敗してPG_BINの設定を促す。

# サーバのメジャー版に対応するPostgreSQLバイナリのディレクトリを標準出力へ返す。
# 解決できない場合は非ゼロ終了する(呼び出し側は中止すること)。
resolve_pg_bin() {
  local url="$1"
  local server_num server_major candidate fallback fallback_version fallback_major

  server_num="$("${PG_CLIENT_PROBE:-psql}" "$url" -v ON_ERROR_STOP=1 -Atc "show server_version_num" 2>/dev/null || true)"
  if [[ ! "$server_num" =~ ^[0-9]+$ ]]; then
    echo "PostgreSQLクライアントの解決に失敗しました: サーバ版を取得できません(${url})" >&2
    return 5
  fi

  # server_version_numは6桁(例: 160014, 180004)。先頭2桁がメジャー版。
  server_major="${server_num:0:2}"

  # 1) Debian/Ubuntuのaptレイアウトでサーバと同じメジャー版が入っていればそれを使う。
  candidate="/usr/lib/postgresql/${server_major}/bin"
  if [[ -x "${candidate}/pg_dump" && -x "${candidate}/pg_restore" ]]; then
    printf '%s\n' "$candidate"
    return 0
  fi

  # 2) フォールバック: pg_configの版がサーバと一致する場合のみ使う。
  #    GitHub Actionsのrunnerなど、aptレイアウト以外の環境のための経路。
  fallback="$(pg_config --bindir 2>/dev/null || true)"
  if [[ -n "$fallback" && -x "${fallback}/pg_dump" ]]; then
    fallback_version="$("${fallback}/pg_dump" --version 2>/dev/null | awk '{print $3}')"
    fallback_major="${fallback_version%%.*}"
    if [[ "$fallback_major" == "$server_major" ]]; then
      printf '%s\n' "$fallback"
      return 0
    fi
    echo "PostgreSQLクライアントの解決に失敗しました: サーバはメジャー版${server_major}ですが、pg_configは${fallback_version}を指しています。" >&2
    echo "  版が新しいクライアントのpg_dumpは、古いサーバへ復元できないdumpを作ります。" >&2
    echo "  環境変数 PG_BIN にメジャー版${server_major}のbinディレクトリを設定してください。" >&2
    return 5
  fi

  echo "PostgreSQLクライアントの解決に失敗しました: ${candidate} も pg_config も利用できません。" >&2
  echo "  環境変数 PG_BIN にサーバと同じメジャー版のbinディレクトリを設定してください。" >&2
  return 5
}
