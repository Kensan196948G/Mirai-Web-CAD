# API/DBメモ

## 予定API

| Method | Path | 用途 |
| --- | --- | --- |
| `GET` | `/api/health` | 実装済み。API/Auth/DB modeを返す |
| `GET` | `/api/drawings/demo` | 実装済み。デモ図面取得 |
| `POST` | `/api/drawings` | 実装済み。空/デモテンプレート、図面名、mm/mを指定して重複実行なしで作成 |
| `GET` | `/api/drawings/:drawingId` | 実装済み。図面取得 |
| `POST` | `/api/drawings/:drawingId/transactions` | 実装済み。CAD Coreコマンド一括適用 |
| `POST` | `/api/drawings/:drawingId/agent-runs` | 実装済み。AI提案作成 |
| `POST` | `/api/agent-runs/:runId/approve` | 実装済み。AI提案を人の承認で適用 |
| `POST` | `/api/drawings/:drawingId/review` | 実装済み。レビュー提出、承認、新版 |
| `GET` | `/api/audit-logs` | 実装済み。承認系権限のみ |

## DB設計方針

- 図面は`drawings`、版は`drawing_versions`、操作は`command_events`へ分離
- AIは`agent_runs`にPrompt、Skill、Proposal、Riskを保存し、直接図面を書き換えない
- 承認は`reviews`へ記録し、承認済み版の上書きを禁止する
- 監査は`audit_logs`へ追記する
- `idempotency_keys`で更新リクエストの重複実行を拒否する
- `drawings.revision`を比較更新し、古いクライアントからの更新を409で拒否する
- Localはメモリストア、Cloudflare Preview/Productionは`DATABASE_URL`またはHyperdriveでNeonへ接続する

## セキュリティ方針

- Cloudflare Access JWTをJWKS、issuer、audienceで検証し、Worker境界でfail-closed
- Accessロールは`ACCESS_ROLE_MAP`/`ACCESS_DEFAULT_ROLE`から決定し、クライアント指定を信頼しない
- Custom Domainの静的SPAは一般公開し、署名済みAccess JWTがないAPI要求は401で拒否する
- `Idempotency-Key`と`expectedVersion`を更新APIへ要求
- Tool CallはJSON Schema検証後、サーバー側で再認可
- 図面内文字列はPrompt命令ではなく非信頼データとして扱う

## ローカルAPI検証

```bash
npm run build
wrangler pages dev dist --port=4176
curl http://127.0.0.1:4176/api/health
```

## Migration

| File | 内容 |
| --- | --- |
| `0001_initial.sql` | project、drawing/version、command、agent、review、audit |
| `0002_idempotency.sql` | 更新APIの重複実行防止 |
| `0003_drawing_revision.sql` | 図面更新の楽観ロック用revision |
| `seeds/demo.sql` | 5レイヤー、4図形の再実行安全なデモ図面 |

Neon検証ブランチ`mirai-web-cad-pr-15`の空DB`mirai_web_cad_verify`で、初期テーブル0件から2回適用後も8テーブル、Seed各1件、revision列を確認しました。
