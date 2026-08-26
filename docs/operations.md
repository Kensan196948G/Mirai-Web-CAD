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

Cloudflare Pagesのrollbackは直前の成功Deploymentを再昇格します。DB migrationは破壊的変更を含めていないため、rollback時も既存テーブルを削除しません。Access障害時も認証を迂回せず、Pages側を直前Versionへ戻して原因を調査します。

本番DeployはGitHub Actionsの`Mirai Web CAD Production`だけから実行します。GitHub既定branchとPages production branchは`fix/auth-guard-fail-closed`に統一し、全検証後にDeploy、Pages公開面200、API未認証401、Custom Domain未認証302を確認します。

## 監視観点

- SPA 200応答
- Canvas描画が空白でないこと
- LocalStorage保存失敗の有無
- `/api/health`、認証fail-closed、書き込み監査ログを確認
- `/api/health`の`db.mode=connected`、`migrated=true`、migration versionを確認
- 作図/AI承認後の別リクエスト再読込と`audit_logs`を確認
- Cloudflare Functions Logsで5xx、JWT検証失敗、Neon接続失敗を確認

## 既知制約

- DWG/DXF/PDF実変換は未実装
- AIは外部LLMではなくルールベースのMVP提案
- Previewは`https://mvp-round-4.mirai-web-cad.pages.dev/`
- 本番Custom Domainは`https://mirai-web-cad.mirai-dx-platform.com/`。Access未認証時302を確認済み
- Production環境は`AUTH_MODE=access`、Preview環境は`AUTH_MODE=demo`として分離
- Production DBはNeon primary branchの専用DB`mirai_web_cad_production`を使用
- OpenDesign外部正本へ接続する手段は現環境にないため、リポジトリ内仕様HTMLとの整合を正本として確認中
