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

## リリース判定基準(2026-08-29追記)

**`CI`ワークフロー(pull_request/push時のLint/Test/Build/E2E/A11y等)の成功は「コード品質が基準を満たしている」ことのみを保証し、「本番が正常稼働している」ことは保証しません。** CIはephemeralなPostgreSQLコンテナを使うため、実際のNeon本番DB接続・資格情報の健全性は検証できません(2026-08-29のIssue #22はこの盲点で発生し、CI全green・Production workflowのDeployジョブ成功後も`Verify public boundary`ステップの失敗で発覚しました)。

本番の正常稼働は、必ず以下の**両方**で判定してください。

1. `Production`ワークフロー(`main`へのpush後に自動実行)の`Deploy Cloudflare Pages`ジョブ、特に`Verify public boundary`ステップが成功していること(`gh run list --branch main`で直近のProduction run結果を確認)
2. 15分間隔で実行される`Synthetic Monitor`ワークフロー(`.github/workflows/synthetic-monitor.yml`)が`incident`ラベルの未解決Issueを起票していないこと、または`https://mirai-web-cad.mirai-dx-platform.com/api/health`を直接確認して`{"ok":true}`(200)が返ること

「mainへのマージが成功した」「CIが緑だった」だけをもって本番正常と報告しないでください。

## Rollback

Cloudflare Pagesのrollbackは直前の成功Deploymentを再昇格します。DB migrationは破壊的変更を含めていないため、rollback時も既存テーブルを削除しません。静的SPAの公開設定とWorker APIの認証境界は別々に確認します。

本番Deployは独立リポジトリのGitHub Actions `Production`だけから実行します。GitHub既定branchとPages production branchは`main`に統一し、全検証後にDeployします。SPA、health、公開デモは匿名200、任意図面と全writeは未認証401を確認します。

### GitHub Actions配信の確立(2026-08-27)

2026-08-27に、`CLOUDFLARE_ACCOUNT_ID`と`CLOUDFLARE_API_TOKEN`(Account→Cloudflare Pages→Edit権限のみ)をActions Secretsへ、`CLOUDFLARE_DEPLOY_ENABLED=true`をActions Variableへ設定し、Production workflowのDeployジョブがGitHub Actionsから直接本番配信する経路を復旧しました。初回確認はworkflow_dispatch(run `33068224659`)で実施し、Verify ReleaseとDeploy Cloudflare Pagesの両ジョブ、およびDeploy内の`Verify public boundary`(SPA/health/demo 200、write 401)が成功しました。以後、`main`へのpushは`push`イベントで同経路から自動配信されます。

Actions Secrets/Variablesを操作するには、Actions書き込み権限を持つトークンが必要です(fine-grained PATの場合は`Actions: Read and write`、OAuth/classicの場合は`repo`+`workflow`)。秘密値をworkflow inputやGit履歴へ渡してはいけません。

### 2026-08-27 実績(ローカルWrangler配信 — 移行期の暫定運用)

Actions Secrets/Variables APIが403(Issue #9)だった移行期のみ、`feat(ops)` PR #18(merge commit `77f71bd`)をローカルWrangler認証で本番配信しました。**同日中にGitHub Actions経路が復旧したため、以後はローカル配信は行いません。**

```bash
npm run build
npx wrangler pages deploy dist --project-name mirai-web-cad \
  --branch main --commit-hash "$(git rev-parse HEAD)"
```

- Cloudflare deployment `0f0784ac-e209-4c4f-bc96-071056451bb9`(production、stage success)
- 配信後にSPA/health/demo 200、write/audit-logs匿名401、healthの`status/version/timestamp`を確認

## 監査ログの追記専用化(0005)

`audit_logs`はDBトリガーでUPDATE/DELETEが拒否されます(errcode `42501`)。INSERTのみ許可です。DB権限保有者でも既存行の改変・削除はできません。トリガーを無効化する場合(監査ポリシー変更時のみ):

```sql
drop trigger audit_logs_no_update on audit_logs;
drop trigger audit_logs_no_delete on audit_logs;
```

監査データの棚卸は承認者権限で`GET /api/audit-logs?format=csv`(export操作自体が`audit.exported`として記録されます)。

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

## 合成監視・障害Issue自動起票(2026-08-29)

`.github/workflows/synthetic-monitor.yml`が15分毎(`workflow_dispatch`でも手動実行可)に、Pages既定URLとCustom Domainの両方でSPA/health/demo図面の200と、任意write APIの401 fail-closedを確認します。

- 失敗時: `incident`+`synthetic-monitor`両ラベルを持つ既存Open Issueがあれば追記コメント、なければ新規Issueを自動起票し、ジョブを失敗させてActionsの通知(既定のGitHub通知経路)を発報します。
- 復旧時: 同条件で見つけたIssueへ復旧コメントを追記してcloseします。`synthetic-monitor`ラベルはこのworkflowが作成したIssueだけを対象にする識別子で、人が起票した`incident`ラベルのIssueを誤ってcloseしないようにしています。
- Teams/Slack Webhook通知(任意): Actions Secret `MONITOR_WEBHOOK_URL`にIncoming Webhook URLを設定すると、失敗時にWebhook通知も送信します。未設定の場合はIssue起票のみで運用でき、追加のSecrets登録なしで機能します。

GitHub Actions `schedule`は負荷状況により実行が遅延・間引かれることがあるため、5分間隔の保証はされません(公式仕様)。7名のIT・DX部門での一次窓口として、Issue起票を主経路、Webhookを補助経路とします。

制約: 実行間隔の保証がない、当番表・重大度別SLAは未整備、Cloudflare側のログ相関(request ID起点の5xx分析)は手動確認のままです。これらはIssue #8の残課題として管理します。

## 本番バックアップ自動化(2026-08-29)

`.github/workflows/backup-production.yml`が毎日 UTC 18:00(JST 03:00)に、Actions Secret `PRODUCTION_DATABASE_URL`を使ってNeon本番DBの`pg_dump`カスタムアーカイブを取得し、GitHub Actions artifact(35日保持、GitHub管理下で暗号化)として保存します。

設定手順(人間による承認・投入が必要。Secretsへ本番接続文字列を投入する操作のため自動実行しません):

1. Neon Consoleで本番DB用の読み取り専用ロールを作成する(推奨。既存roleを流用する場合は最小権限を確認する)。
2. リポジトリ設定 → Secrets and variables → Actions → New repository secretで`PRODUCTION_DATABASE_URL`を登録する(`postgresql://<readonly-role>:<password>@<host>/mirai_web_cad_production?sslmode=require`形式)。
3. `workflow_dispatch`で`Production Backup`を手動実行し、成功を確認する。
4. 以後は日次自動実行を確認する。失敗時は`incident`+`backup-automation`両ラベルでIssueが自動起票される(重複起票を避けるため、既存Open Issueがあれば追記コメント)。

Secret未設定の間は、ジョブが`ops`+`backup-automation`両ラベルのIssueを一度だけ起票してバックアップをスキップします(失敗扱いにはしません)。artifactの保存先をGitHub Actions外(Cloudflare R2やAzure Blob等の長期保管)へ拡張する場合、保存先・暗号鍵・保持期間・費用・復元責任者の合意が別途必要です。RPO/RTO目標は既存の「Backup / Restore」節を参照してください。

## Incident Response

1. 検知: Cloudflare 5xx、health/demo失敗、Neon接続、認証失敗率、利用者申告をrequest IDで関連付ける。
2. 初動: 更新を止める場合はAccess policyまたはFunctions deployを変更し、静的閲覧を維持する。証跡を保存する。
3. 判定: UI、API、Auth、DB、外部サービスのどの層か切り分ける。本番DBへ直接修正しない。
4. 復旧: 直前Pages Deploymentを再昇格する。DBは復旧branchで内容確認後に切替判断する。
5. 確認: health、公開デモ、未認証write 401、認証済み作図/再読込、監査をsmoke testする。
6. 事後: 発生/検知/復旧時刻、影響図面、request ID、原因、再発防止をIssueへ残す。

自動alert、連絡先、当番表、重大度別SLAは未設定。Production移行前にCloudflare通知からTeams/メールへの経路を確定する。合成監視によるIssue自動起票(上記)は導入済みだが、当番表と重大度別SLAは引き続き未設定。

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
