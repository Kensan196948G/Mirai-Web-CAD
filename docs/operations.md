# 運用・復旧メモ

## ローカル開発

```bash
npm run dev
```

`http://127.0.0.1:4174/`でSPAと`/api`を同一オリジン確認できます。ブラウザ保存はLocalStorageです。破損時は画面左ツールの「デモ初期化」またはブラウザDevToolsで`mirai-web-cad-mvp`キーを削除します。既定ではメモリストア(`env.DATABASE_URL`は無視)です。ローカルPostgreSQLへ接続して確認したい場合は`LOCAL_DB=1`を明示してください。

```bash
LOCAL_DB=1 DATABASE_URL="postgresql://mirai_web_cad_app:...@127.0.0.1:5432/mirai_web_cad" npm run dev
```

## Build

```bash
npm run build
```

`dist/`は静的配信用成果物です。本番は`scripts/serve-production.mjs`がこの`dist/`と`_headers`を配信します(下記「本番アーキテクチャ」参照)。

Cloudflare Pages Functions互換性の参考確認(ロールバック手段としてPages関連ファイルを当面残しているため):

```bash
npm run build
wrangler pages dev dist --port=4176
curl http://127.0.0.1:4176/api/health
```

## 本番アーキテクチャ(2026-08-30〜)

2026-08-30に、本番の永続化先をNeon PostgreSQLからローカルPostgreSQL + Cloudflare Tunnelへ移行しました(ユーザー指示「Neonは今後2度と利用しない」、Issue #22)。

```
Cloudflare Tunnel(mirai-web-cad-cloudflared.service)
  → mirai-web-cad.mirai-dx-platform.com
  → http://127.0.0.1:18812 (mirai-web-cad.service, scripts/serve-production.mjs)
  → ローカルPostgreSQL 16(127.0.0.1:5432, DB=mirai_web_cad)
```

セットアップ手順、systemdユニット一覧、日常運用(デプロイ・バックアップ・ログ確認・ロールバック)は[ローカルデプロイ運用メモ](deployment-local.md)を参照してください。

Cloudflare Pages(`functions/api/`、`wrangler.toml`)はロールバック手段として当面残置していますが、`main`へのマージでは自動デプロイされません(`.github/workflows/production.yml`のdeployジョブは削除済み、`CLOUDFLARE_DEPLOY_ENABLED`変数もPR Preview用途にのみ影響します)。

## ローカルPostgreSQL初期化

```bash
DATABASE_URL="postgresql://mirai_web_cad_app:...@127.0.0.1:5432/mirai_web_cad" npm run db:verify
```

注意:

- 既存データがあるDBへ適用する前に検証用DBへ適用します
- 既存本番データ削除は行いません
- migrationは`create table if not exists`中心、Seedは`on conflict do nothing`で、既存業務データを上書きしません

## リリース判定基準

**`CI`ワークフロー(pull_request/push時のLint/Test/Build/E2E/A11y等)の成功は「コード品質が基準を満たしている」ことのみを保証し、「本番が正常稼働している」ことは保証しません。** CIはephemeralなPostgreSQLコンテナを使うため、実際の本番DB接続の健全性は検証できません(2026-08-29のIssue #22はこの盲点で発生し、CI全green後もNeon資格情報の不整合で本番APIが500になり続けました。移行後の現在もこの原則自体は変わりません)。

本番の正常稼働は、必ず以下を**すべて**満たした場合にのみ判定してください。手動での`/api/health`確認は判定条件の代替にはなりません(health 1エンドポイントだけではSPA表示、公開デモ、書込みfail-closedの回帰を検出できないため)。

1. `mirai-web-cad.service`が`journalctl -u mirai-web-cad -n 20`でエラーなく稼働していること、かつ`scripts/deploy-local.sh`(または手動デプロイ)実行時のhealth確認(`curl -fsS http://127.0.0.1:18812/api/health`)が成功していること
2. `Synthetic Monitor`ワークフロー(`.github/workflows/synthetic-monitor.yml`、15分間隔)の**`main`ブランチの定期実行(`schedule`)が直近で成功しており、かつ実行時刻が現在から1時間以内**であること。`workflow_dispatch`による他ブランチの手動実行はこの判定に含めない(`gh run list --workflow=synthetic-monitor.yml --branch main --event schedule --limit 1 --json conclusion,createdAt,headBranch,event`で`conclusion=success`かつ`headBranch=main`を確認)。`schedule`はGitHub側の負荷で遅延・間引かれることがあるため、実行自体が止まっていないかをこの時刻で確認する
3. 上記2の直近成功実行が`incident`ラベルの未解決Issueを起票していないこと(`gh issue list --label incident --state open`で確認)。2を満たさずに3だけを確認しても、監視が止まっている間の障害を見逃す

「mainへのマージが成功した」「CIが緑だった」「healthが200だった」のいずれか単独をもって本番正常と報告しないでください。

## Rollback

本番はこのホスト(kensan1969)上のsystemdサービスです。ロールバック手順:

```bash
git checkout <直前の正常コミットSHA>
npm ci && npm run build
sudo systemctl restart mirai-web-cad.service
curl -fsS http://127.0.0.1:18812/api/health
```

`scripts/deploy-local.sh`はhealth確認に失敗すると直前コミットへ自動ロールバックします。DB migrationは破壊的変更を含めていないため、ロールバック時も既存テーブルを削除しません。

Cloudflare Tunnel/DNS自体に問題がある場合(Tunnel停止、証明書失効等)は、Cloudflare Pages Custom Domainを再アタッチして`mirai-web-cad.pages.dev`相当の配信へ一時的に切り戻せます(Pagesプロジェクト・`functions/`・`wrangler.toml`はこのためにロールバック手段として残置しています)。ただしPages側のコードは移行前時点のもので、Neon接続を試みるため`/api`は機能しません。SPA表示のみの緊急避難的な切り戻しです。

## 監査ログの追記専用化(0005)

`audit_logs`はDBトリガーでUPDATE/DELETEが拒否されます(errcode `42501`)。INSERTのみ許可です。DB権限保有者でも既存行の改変・削除はできません。トリガーを無効化する場合(監査ポリシー変更時のみ):

```sql
drop trigger audit_logs_no_update on audit_logs;
drop trigger audit_logs_no_delete on audit_logs;
```

監査データの棚卸は承認者権限で`GET /api/audit-logs?format=csv`(export操作自体が`audit.exported`として記録されます)。

## Backup / Restore

CIは一時PostgreSQLにMigration/Seedを適用し、custom archiveを空DBへ復元します(`.github/workflows/ci.yml`の`recovery`ジョブ)。同ワークフローの`postgres-integration`ジョブは復元は行わず、`db:verify`(migration適用)と`tests/data-store.pg.test.js`の実DB統合テストのみを実行します。

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

本番の日次バックアップは`mirai-web-cad-backup.timer`(systemd、毎日03:10 JST)が担い、`/var/backups/mirai-web-cad/postgres/`へ保存します(保持14日)。詳細は[ローカルデプロイ運用メモ](deployment-local.md)を参照。暫定目標はRPO 24時間、RTO 4時間。オフサイト転送(R2等)は未実施で、保存先・暗号鍵・保持期間・費用・復元責任者の合意が別途必要です。

## 合成監視・障害Issue自動起票

`.github/workflows/synthetic-monitor.yml`が15分毎(`workflow_dispatch`でも手動実行可)に、Custom DomainでSPA/health/demo図面の200と、任意write APIのfail-closed(2026-08-30〜Cloudflare Access保護により302、未設定時は401)を確認します。

- 失敗時: `incident`+`synthetic-monitor`両ラベルを持つ既存Open Issueがあれば追記コメント、なければ新規Issueを自動起票し、ジョブを失敗させてActionsの通知(既定のGitHub通知経路)を発報します。
- 復旧時: 同条件で見つけたIssueへ復旧コメントを追記してcloseします。`synthetic-monitor`ラベルはこのworkflowが作成したIssueだけを対象にする識別子で、人が起票した`incident`ラベルのIssueを誤ってcloseしないようにしています。
- Teams/Slack Webhook通知(任意): Actions Secret `MONITOR_WEBHOOK_URL`にIncoming Webhook URLを設定すると、失敗時にWebhook通知も送信します。未設定の場合はIssue起票のみで運用でき、追加のSecrets登録なしで機能します。

GitHub Actions `schedule`は負荷状況により実行が遅延・間引かれることがあるため、設定した15分間隔の実行は保証されません(公式仕様)。7名のIT・DX部門での一次窓口として、Issue起票を主経路、Webhookを補助経路とします。

制約: 実行間隔の保証がない、当番表・重大度別SLAは未整備です。これらはIssue #8の残課題として管理します。

## 本番バックアップ自動化

日次バックアップはローカルsystemd timer(`mirai-web-cad-backup.timer`)が担います。GitHub Actions(クラウドhosted runner)からこのホストのPostgreSQLへ直接到達できないため、GitHub Actionsでのバックアップは行いません(旧`.github/workflows/backup-production.yml`は廃止)。

- `mirai-web-cad-backup.timer`: 毎日03:10 JST、`scripts/backup-local.sh`(既存の`scripts/backup-database.sh`を無変更で呼ぶ)を実行し、`/var/backups/mirai-web-cad/postgres/`へdump保存(保持14日)
- `mirai-web-cad-backup-check.timer`: 毎日06:00 JST、最新dumpが36時間以内・0バイト超であることを検証

手動実行・詳細手順は[ローカルデプロイ運用メモ](deployment-local.md)を参照。

## Incident Response

1. 検知: `journalctl -u mirai-web-cad -u mirai-web-cad-cloudflared`のエラー、health/demo失敗、DB接続失敗、認証失敗率、利用者申告をrequest IDで関連付ける。合成監視によるIssue自動起票も一次検知経路として機能する。
2. 初動: 更新を止める場合はCloudflare Access policyまたは`mirai-web-cad.service`を停止し、静的SPA閲覧の可否を確認する。証跡を保存する。
3. 判定: UI、API、Auth、DB、Tunnelのどの層か切り分ける。本番DBへ直接修正しない。
4. 復旧: 上記Rollback手順に従う。DBは復旧branchで内容確認後に切替判断する。
5. 確認: health、公開デモ、未認証write fail-closed(302または401)、認証済み作図/再読込、監査をsmoke testする。
6. 事後: 発生/検知/復旧時刻、影響図面、request ID、原因、再発防止をIssueへ残す。

自動alert(合成監視Issue自動起票)は導入済みだが、当番表・連絡先・重大度別SLAは引き続き未設定。

## 監視観点

- SPA 200応答とCSP/frame/Permissions-Policy header
- Canvas描画が空白でないこと
- LocalStorage保存失敗の有無
- `/api/health`と公開デモ200、任意図面/書き込みの認証fail-closed、書き込み監査ログを確認
- `/api/health`の`db.mode=connected`、`migrated=true`、`provider=postgres`を確認
- 作図/AI承認後の別リクエスト再読込と`audit_logs`を確認
- `journalctl -u mirai-web-cad -u mirai-web-cad-cloudflared`で5xx、JWT検証失敗、DB接続失敗を確認

## 既知制約

- Mirai JSONとASCII DXFの2D Importに対応。DWG、DXF書出し、PDF、寸法、ブロック、ハッチは試作〜限定対応(README参照)
- AIは外部LLMではなくルールベースのMVP提案
- 本番Custom Domainは`https://mirai-web-cad.mirai-dx-platform.com/`。SPA、health、公開デモは匿名200。任意図面と全更新は未認証401
- `mirai-web-cad.pages.dev`はロールバック手段として残置しているが、mainマージでは更新されない(SPAのみ200、`/api`は移行前のNeon接続コードのまま機能しない)
- Production環境は`AUTH_MODE=access`。Cloudflare Access(`mirai-web-cad-api`、`/api/*`保護、`kensan1969@gmail.com`のみallow)を2026-08-30に設定。未ログイン・未認証の書き込みはAccessログインへの302で拒否(SPA/health/demoはbypass設定で引き続き匿名可)。ログイン方式はOne-Time PIN(Entra ID等の外部IdP未連携)。案件単位RBAC・複数利用者への展開は引き続きIssue #5の残課題
- Production DBはこのホスト(kensan1969)上のローカルPostgreSQL 16、DB名`mirai_web_cad`
- 本番サービスがこのホストの稼働・ネットワークに依存する。ホスト停止・ネットワーク断で本番が停止する
- `mirai-web-cad.service`のsystemdユニットは`IPAddressDeny=any`を採用していない(Cloudflare Access JWKS取得の外向きHTTPSに必要なため)。インバウンド制限は`127.0.0.1`バインドと`RestrictAddressFamilies`で担保している
- CI(GitHub Actions)からはこのホストへ直接デプロイできないため、デプロイは`scripts/deploy-local.sh`の手動実行に依存する。self-hosted runner化は将来の別Issueとする
- バックアップのオフサイト転送(R2等)は未実施
- OpenDesign外部正本へ接続する手段は現環境にないため、リポジトリ内仕様HTMLとの整合を正本として確認中
