# PostgreSQL障害Runbook

本番DB`mirai_web_cad`とMVP DB`mirai_web_cad_mvp`は同じローカルPostgreSQL上にあります。復元先には必ず隔離DBを使い、稼働DBへ直接`pg_restore --clean`しません。

## 初動と保全

```bash
sudo systemctl stop mirai-web-cad.service mirai-web-cad-mvp.service
sudo systemctl status postgresql --no-pager
sudo journalctl -u postgresql --since '-60 minutes' --no-pager
sudo systemctl start mirai-web-cad-backup.service
sudo systemctl start mirai-web-cad-mvp-backup.service
```

停止時刻、最後に成功した保存、影響図面、最新backupの時刻とサイズをIssueへ記録します。ストレージ障害やPostgreSQL停止で新規backupを取得できない場合は、既存dumpを上書きしません。

## 隔離復元検証

MVPは自動化済みの隔離DBで検証します。

```bash
sudo systemctl start mirai-web-cad-mvp-restore-drill.service
sudo systemctl show mirai-web-cad-mvp-restore-drill.service -p Result -p ExecMainStatus --no-pager
sudo journalctl -u mirai-web-cad-mvp-restore-drill.service -n 50 --no-pager
```

本番も空の隔離DBを用意し、`RESTORE_DATABASE_URL`、`BACKUP_FILE`、`ALLOW_DATABASE_RESTORE=yes`を明示して`scripts/restore-database.sh`を使います。接続先DB名を作業者と確認者の2名で読み合わせてから実行します。dumpと同時生成された`.manifest`がないバックアップは切替に使用しません。

## 切替判断

- `pg_restore --list`が成功し、`projects`、`drawings`、`drawing_versions`、`audit_logs`が各1件以上であることを確認する。
- manifestのSHA-256がdumpと一致し、取得時刻が最大許容RPO 24時間以内であることを確認する。例外的に古い世代を調査するときも本番切替は停止し、取得時刻、manifest、許容RPO、判断者をincidentへ記録する。
- バックアップ取得時に記録した4表の件数と、各図面ID・`current_version`・最新版`content_hash`から作る署名が復元先と完全一致することを確認する。スクリプトの`manifest_match=yes`が合格条件。
- 全図面の`current_version`が実在する最大`version_no`と一致し、`latest_version_mismatches=0`であることを確認する。
- JSONBは`drawing_versions.content`と`audit_logs.detail`がobject、`command_events.command_payload`がobject/array、`agent_runs.proposal`がSQL NULLまたはobject/arrayであることを確認する。JSONのstring・number・boolean・nullは不合格で、`invalid_json=0`だけを切替候補にする。
- RPOを算出し、失われる可能性がある保存操作を列挙する。
- 元DBは削除せず名前を退避し、検証済みDBへの切替手順を別planとしてレビューする。
- 接続先env更新後はmode `0600`を維持し、資格情報をIssueへ貼らない。

## 復旧確認

```bash
sudo systemctl start mirai-web-cad.service mirai-web-cad-mvp.service
sudo systemctl start mirai-web-cad-mvp-monitor.service
```

health、図面読込み、1回の保存、再読込み、監査ログ、バックアップ鮮度を確認します。復旧時刻、実測RPO/RTO、失われた操作、原因、再発防止をincidentへ記録します。
