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

本番も空の隔離DBを用意し、`RESTORE_DATABASE_URL`、`BACKUP_FILE`、`ALLOW_DATABASE_RESTORE=yes`を明示して`scripts/restore-database.sh`を使います。接続先DB名を作業者と確認者の2名で読み合わせてから実行します。

## 切替判断

- `pg_restore --list`成功、表件数、最新図面版、監査ログ、JSONB型を確認する。
- RPOを算出し、失われる可能性がある保存操作を列挙する。
- 元DBは削除せず名前を退避し、検証済みDBへの切替手順を別planとしてレビューする。
- 接続先env更新後はmode `0600`を維持し、資格情報をIssueへ貼らない。

## 復旧確認

```bash
sudo systemctl start mirai-web-cad.service mirai-web-cad-mvp.service
sudo systemctl start mirai-web-cad-mvp-monitor.service
```

health、図面読込み、1回の保存、再読込み、監査ログ、バックアップ鮮度を確認します。復旧時刻、実測RPO/RTO、失われた操作、原因、再発防止をincidentへ記録します。
