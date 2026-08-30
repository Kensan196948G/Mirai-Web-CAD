# API/DBメモ

## 予定API

| Method | Path | 用途 |
| --- | --- | --- |
| `GET` | `/api/health` | 実装済み。匿名可。DB名などの内部情報は認証時のみ返す |
| `GET` | `/api/drawings/demo` | 実装済み。`visibility=public`のデモ図面だけ匿名取得可 |
| `POST` | `/api/drawings` | 実装済み。空/デモテンプレート、図面名、mm/mを指定して重複実行なしで作成 |
| `GET` | `/api/drawings/:drawingId` | 実装済み。図面取得 |
| `POST` | `/api/drawings/:drawingId/transactions` | 実装済み。CAD Coreコマンド一括適用 |
| `POST` | `/api/drawings/:drawingId/agent-runs` | 実装済み。AI提案作成。ルールベースが`needs_input`かつプロンプトありかつサーバー側でLLM(OpenAI/Anthropic)が設定済みの場合のみフォールバック(fail-soft、LLM障害時もルールベース結果を返す)。actor単位でLLM呼び出しのみレート制限(既定10回/分) |
| `POST` | `/api/agent-runs/:runId/approve` | 実装済み。AI提案を人の承認で適用 |
| `POST` | `/api/drawings/:drawingId/review` | 実装済み。レビュー提出、承認、新版 |
| `POST` | `/api/drawings/:drawingId/comments` | 実装済み。`canComment`権限(reviewerも可)。コメント追加、監査ログに本文は記録しない |
| `GET` | `/api/audit-logs` | 実装済み。承認系権限のみ。`limit`/`offset`ページング、`?format=csv`でCSV export(数式注入ガード付き) |
| `GET` | `/api/ai/status` | 実装済み。`canRunAi`権限。`AI_PROVIDER`/`OPENAI_API_KEY`/`ANTHROPIC_API_KEY`/`AI_MODEL`環境変数から有効状態・プロバイダ名・モデル名のみ返す(APIキー自体は返さない)。APIキーはブラウザに一切保存・送信しない |

## DB設計方針

- 図面は`drawings`、版は`drawing_versions`、操作は`command_events`へ分離
- AIは`agent_runs`にPrompt、Skill、Proposal、Riskを保存し、直接図面を書き換えない
- 承認は`reviews`へ記録し、承認済み版の上書きを禁止する
- 監査は`audit_logs`へ追記する
- `idempotency_keys`で更新リクエストの重複実行を拒否する
- `drawings.revision`を比較更新し、古いクライアントからの更新を409で拒否する
- `drawings.visibility`は既定`private`。匿名経路は`public`だけを取得する
- 図面、版、command event、監査、Idempotency、AI承認状態は単一SQL statementで原子的に確定する
- Localは既定でメモリストア、`DATABASE_URL`(`LOCAL_DB=1`明示時)またはProduction(`scripts/serve-production.mjs`)はローカルPostgreSQL 16へ`postgres`(postgres.js)経由で接続する(2026-08-30〜、Issue #22でNeon/Hyperdriveから移行)

## セキュリティ方針

- Cloudflare Access JWTをJWKS、issuer、audienceで検証し、Worker境界でfail-closed
- Accessロールは`ACCESS_ROLE_MAP`/`ACCESS_DEFAULT_ROLE`から決定し、クライアント指定を信頼しない
- Custom Domainの静的SPA、health、公開デモは匿名可。任意図面取得と全更新は署名済みAccess JWTがなければ401
- `Idempotency-Key`と`expected-version`を更新APIへ要求
- POST本文は`application/json`かつ1 MiB以下。Production CORSは既定でCustom Domain限定。`CORS_ORIGIN`にカンマ区切りで複数オリジンを設定すると、リクエストの`Origin`ヘッダが許可リスト内の場合のみそのオリジンを反映し(`Vary: Origin`付き)、リスト外や未指定時は許可リスト先頭のオリジンを返す(任意オリジンを無条件反映しない)
- CSP、frame拒否、Permissions-Policy、nosniffを静的/API応答の両方へ設定
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
| `0004_drawing_visibility.sql` | 匿名公開を明示し、既定をprivateに固定 |
| `0005_audit_log_immutability.sql` | `audit_logs`をDBトリガーで追記専用化(UPDATE/DELETE拒否) |
| `seeds/demo.sql` | 5レイヤー、4図形の再実行安全なデモ図面 |

Neon Preview/Productionへ`0004`を適用し、デモだけがpublicであることを確認しました(2026-08-27時点、Neon利用時代の記録)。2026-08-30の移行後は、ローカルPostgreSQL 16の本番DB(`mirai_web_cad`)へ全migrationを適用済みです。

`0005`は`db:verify`の中で、トリガー2件の存在と、UPDATE/DELETEが`42501`で拒否されることを機械検証します。監査ログはDB権限保有者を含め改変・削除できません(物理的なリストアやテーブル再作成を除く)。
