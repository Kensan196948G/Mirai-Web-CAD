# サービス停止Runbook

対象は本番`mirai-web-cad.service`、MVP`mirai-web-cad-mvp.service`、共通Tunnel`mirai-web-cad-cloudflared.service`です。まずGitHub Issueへ発生時刻、対象URL、request ID、実行した操作を記録します。

## 切り分け

```bash
sudo systemctl status postgresql mirai-web-cad.service mirai-web-cad-mvp.service mirai-web-cad-cloudflared.service --no-pager
sudo journalctl -u mirai-web-cad.service -u mirai-web-cad-mvp.service -u mirai-web-cad-cloudflared.service --since '-30 minutes' --no-pager
curl --fail --silent http://127.0.0.1:18812/api/health
curl --fail --silent http://127.0.0.1:18813/api/health
curl --silent --output /dev/null --write-out '%{http_code}\n' https://mirai-web-cad-mvp.mirai-dx-platform.com/
```

- ローカルhealthのみ失敗: アプリまたはDBを調査する。
- ローカルhealth成功、公開のみ失敗: Tunnel、DNS、Accessを調査する。
- 本番とMVPが同時停止: PostgreSQL、Tunnel、ホスト、ネットワークを優先する。

## 復旧

以下から異常なunitだけを再起動します。PostgreSQLや共通Tunnelを正常なのに再起動すると、本番とMVPの両方に不要な停止が発生します。

```bash
# DB自体が異常な場合のみ
sudo systemctl restart postgresql

# 異常なアプリだけ
sudo systemctl restart mirai-web-cad.service
sudo systemctl restart mirai-web-cad-mvp.service

# ローカルhealthが正常で公開URLだけ異常な場合のみ
sudo systemctl restart mirai-web-cad-cloudflared.service

sudo systemctl start mirai-web-cad-mvp-monitor.service
```

DBに破損やデータ欠落の疑いがある場合は再起動を繰り返さず、`database-incident.md`へ移ります。Access設定を変更して回避せず、Access障害は`cloudflare-access-change.md`に従います。

## 完了条件

- 両ローカルhealthがPostgreSQL connected/migratedを返す。
- MVP監視が`Result=success`、公開MVPがAccessへ302となる。
- 認証済み利用者が図面を開き、1回だけ保存・再読込みできる。
- 監査ログへ保存操作が残り、incidentへ復旧時刻と原因を記録する。
