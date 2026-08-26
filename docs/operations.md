# 運用・復旧メモ

## ローカル運用

```bash
npm run dev
```

`http://127.0.0.1:4174/`でSPAと`/api`を同一オリジン確認できます。ブラウザ保存はLocalStorageです。破損時は画面左ツールの「デモ初期化」またはブラウザDevToolsで`mirai-web-cad-mvp`キーを削除します。

## Build

```bash
npm run build
```

`dist/`は静的配信用成果物です。Cloudflare Pagesへ配信する場合は、build commandを`npm run build`、output directoryを`dist`にします。Functionsは`functions/api/[[path]].js`から`src/api-handler.js`を呼び出します。

Cloudflareローカル互換確認:

```bash
npm run build
wrangler pages dev dist --port=4176
curl http://127.0.0.1:4176/api/health
```

## Neon初期化

```bash
DATABASE_URL="postgresql://..." npm run db:verify
```

注意:

- 本番DBへ適用する前にPreview/検証DBへ適用します
- 既存本番データ削除は行いません
- migrationは`create table if not exists`中心、Seedは`on conflict do nothing`で、既存業務データを上書きしません

## Rollback

Cloudflare Pagesのrollbackは直前の成功Deploymentを再昇格します。DB migrationは破壊的変更を含めていないため、rollback時も既存テーブルを削除しません。静的SPAの公開設定とWorker APIの認証境界は別々に確認します。

本番DeployはGitHub Actionsの`Mirai Web CAD Production`だけから実行します。GitHub既定branchとPages production branchは`fix/auth-guard-fail-closed`に統一し、全検証後にDeployします。SPA、health、公開デモは匿名200、任意図面と全writeは未認証401を確認します。

## Backup / Restore

CIは一時PostgreSQLにMigration/Seedを適用し、custom archiveを空DBへ復元します。

```bash
DATABASE_URL="postgresql://source" \
  BACKUP_FILE="artifacts/mirai-web-cad.dump" \
  npm run db:backup

RESTORE_DATABASE_URL="postgresql://empty-recovery-db" \
  BACKUP_FILE="artifacts/mirai-web-cad.dump" \
  ALLOW_DATABASE_RESTORE=yes \
  npm run db:restore
```

安全条件:

- 復元先は必ず空の検証DBとし、本番接続文字列を指定しない
- `ALLOW_DATABASE_RESTORE=yes`は復元実行時だけ設定する
- archiveは`umask 077`で作成し、Gitへ追加しない
- 復元後に件数だけでなく、実ブラウザでデモ取得、作図、再読込を確認する
- 本番はNeonの復旧窓と独立archiveの二系統を設計する。現状の履歴保持1日は本番基準未達
- 暫定目標はRPO 24時間、RTO 4時間。業務影響分析後にRPO 1時間以下を検討する

Production実データのbackup/restoreは未実施である。実施には保存先、暗号鍵、保持期間、費用、復元責任者の承認が必要。

## Incident Response

1. 検知: Cloudflare 5xx、health/demo失敗、Neon接続、認証失敗率、利用者申告をrequest IDで関連付ける。
2. 初動: 更新を止める場合はAccess policyまたはFunctions deployを変更し、静的閲覧を維持する。証跡を保存する。
3. 判定: UI、API、Auth、DB、外部サービスのどの層か切り分ける。本番DBへ直接修正しない。
4. 復旧: 直前Pages Deploymentを再昇格する。DBは復旧branchで内容確認後に切替判断する。
5. 確認: health、公開デモ、未認証write 401、認証済み作図/再読込、監査をsmoke testする。
6. 事後: 発生/検知/復旧時刻、影響図面、request ID、原因、再発防止をIssueへ残す。

自動alert、連絡先、当番表、重大度別SLAは未設定。Production移行前にCloudflare通知からTeams/メールへの経路を確定する。

## 監視観点

- SPA 200応答とCSP/frame/Permissions-Policy header
- Canvas描画が空白でないこと
- LocalStorage保存失敗の有無
- `/api/health`と公開デモ200、任意図面/書き込みの認証fail-closed、書き込み監査ログを確認
- `/api/health`の`db.mode=connected`、`migrated=true`、migration versionを確認
- 作図/AI承認後の別リクエスト再読込と`audit_logs`を確認
- Cloudflare Functions Logsで5xx、JWT検証失敗、Neon接続失敗を確認

## 既知制約

- Mirai JSONとASCII DXFの2D Importに対応。DWG、DXF書出し、PDF、寸法、ブロック、ハッチは未実装
- AIは外部LLMではなくルールベースのMVP提案
- Previewは`https://mvp-round-5.mirai-web-cad.pages.dev/`
- 本番Custom Domainは`https://mirai-web-cad.mirai-dx-platform.com/`。SPA、health、公開デモは匿名200。任意図面と全更新は未認証401
- Production環境は`AUTH_MODE=access`、Preview環境は`AUTH_MODE=demo`として分離
- Production DBはNeon primary branchの専用DB`mirai_web_cad_production`を使用
- Neon mainはprotected化済み。AWS US West、履歴保持1日のため、データ所在と7日以上の復旧窓は契約/費用判断待ち
- OpenDesign外部正本へ接続する手段は現環境にないため、リポジトリ内仕様HTMLとの整合を正本として確認中
