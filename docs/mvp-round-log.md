# Mirai Web CAD MVP Roundログ

## Round 1 / 2026-08-26

| 項目 | 内容 |
| --- | --- |
| 対象課題 | `Mirai-Web-CAD`配下が要件/設計HTMLのみで、実操作可能なMVPが未存在 |
| 判断理由 | 親リポジトリには大規模な既存差分があり、無関係な変更を混ぜるリスクが高い。対象ディレクトリ内で独立MVPを構築するのが最小安全単位 |
| 変更 | 静的SPA、CAD Core、Canvas UI、AI提案プレビュー、権限/承認、検査、測定、LocalStorage保存、JSON出力、migration/seed、検証スクリプトを追加 |
| 設計整合 | 要件書の「CAD Coreが正、AIは支援」「プレビュー後に人が適用」「ロックレイヤー/承認済み版/権限外更新拒否」をMVP実装へ反映 |
| 検証 | `npm run verify`を2回実行し、lint、Node標準テスト、静的buildが成功 |
| 証拠 | `tests/cad-core.test.js`でロック、権限、AI承認ゲート、承認不可、測定を検査。`curl -I http://127.0.0.1:4174/`でHTTP 200を確認 |
| 残存課題 | Cloudflare Workers API、Neon永続化接続、GitHub PR/CI、Cloudflare Preview、本番Deploy、E2E/Visual/A11y自動検査は未実施 |
| 次Round | Worker APIとNeon接続層を追加し、主要フローをブラウザ内保存からサーバー永続化へ拡張する |

## Completion Gate

| Gate | 状態 | 根拠 |
| --- | --- | --- |
| 主要業務フロー実操作 | CONTINUE | ブラウザMVPで作図、AI提案、レビュー、承認は可能 |
| OpenDesign/仕様整合 | CONTINUE | 仕様HTMLの色/画面領域/AI Gateを反映。OpenDesignの外部正本は未接続 |
| 正常/空/Error/権限別状態 | CONTINUE | 正常・Error・権限は実装。空状態の専用UIは今後強化 |
| Migration/Seed | CONTINUE | SQL雛形あり。実Neon適用は未検証 |
| 型検査/Lint/Test/E2E/Build | CONTINUE | `npm run verify`成功。JS MVPのため型検査は未対象。E2EはPlaywright未導入で未実施 |
| Responsive/Keyboard/A11y | CONTINUE | Responsive CSSと基本focusあり。体系的A11y検査は未実施 |
| Preview/本番Deploy | BLOCKER候補 | Cloudflare/Neon/GitHub権限・Secret確認が必要 |
| 文書更新 | CONTINUE | README、運用、API/DB、Roundログを追加 |
| Critical/High解消 | CONTINUE | Core検査ではCritical承認不可。セキュリティスキャン未実施 |

## 検証結果

| コマンド | 結果 | メモ |
| --- | --- | --- |
| `npm run lint` | PASS | 必須ファイル、JS構文、CSS未解決マーカーを確認 |
| `npm test` | PASS | 6 tests / 6 pass |
| `npm run build` | PASS | `dist/`生成 |
| `npm run verify` | PASS | lint + test + build |
| `curl -I http://127.0.0.1:4174/` | PASS | `HTTP/1.0 200 OK` |
| `rg`簡易secret scan | PASS相当 | 実Secret値なし。`DATABASE_URL`は手順書内の環境変数プレースホルダーのみ |

## Round 2 / 2026-08-26

| 項目 | 内容 |
| --- | --- |
| 対象課題 | ブラウザ内MVPだけで、Cloudflare/API/Auth/状態確認/Preview検証が未達 |
| 判断理由 | Completion Gateの「PreviewでUI/API/認証/DB接続確認」「正常・空・Error・権限別状態」を進めるため、Cloudflare Pages Functions互換APIと画面状態レビューを優先 |
| 変更 | `src/api-handler.js`、`functions/api/[[path]].js`、ローカルAPI統合サーバー、APIテスト、静的A11y検査、State Review UI、Cloudflare Pages Previewを追加 |
| 設計整合 | 更新APIへ`Idempotency-Key`/`expected-version`を要求。`AUTH_MODE=access`ではCloudflare Access情報なしをfail-closed。AIはPlan/Preview後に明示承認でTransaction化 |
| 検証 | `npm run verify`成功、`wrangler pages dev dist --port=4176`成功、Cloudflare Previewへデプロイしエッジ経由APIを確認 |
| 証拠 | Preview URL `https://mvp-round-2.mirai-web-cad.pages.dev/`。`/api/health`は`auth=demo`, `db=memory-preview`。AI承認は`entities=11`, `run=completed`。閲覧者Transactionは403相当の権限拒否 |
| 残存課題 | Neon実接続、Cloudflare Access実設定、GitHub PR/CI、実ブラウザE2E/Visual/axe、OpenDesign外部正本照合、本番Deploy/Release後確認は未完了 |
| 次Round | Neon永続化層、DB migration適用検証、GitHub PR/CI、Playwright導入によるPreview E2Eを進める |

## Round 2 検証結果

| コマンド/対象 | 結果 | メモ |
| --- | --- | --- |
| `npm run lint` | PASS | `src`、`functions`、`tests`、`scripts`のJS構文を確認 |
| `npm run a11y` | PASS | lang、viewport、aria、focus-visible、Responsive CSS等を静的検査 |
| `npm test` | PASS | 12 tests / 12 pass |
| `npm run build` | PASS | `dist/`生成 |
| `wrangler pages dev dist --port=4176` | PASS | Pages Functionsローカル互換起動 |
| Cloudflare Preview SPA | PASS | `https://mvp-round-2.mirai-web-cad.pages.dev/` がHTTP 200 |
| Cloudflare Preview API | PASS | `/api/health`、AI提案承認、viewer更新拒否を確認 |
| Neon migration実適用 | 未実施 | `DATABASE_URL`なし、ローカルPostgreSQL未起動。SQLは`create table if not exists`/`on conflict`で再実行可能性を静的確認 |
| GitHub PR | OPEN | PR #15 `https://github.com/Kensan196948G/Construction-Enterprise-OS/pull/15` を作成。CodeRabbit Pendingのため自動マージ未実施 |

## Round 2 Completion Gate

| Gate | 状態 | 根拠 |
| --- | --- | --- |
| 主要業務フロー実操作 | CONTINUE | SPA + APIで作図、AI提案、承認フローを確認。DWG/DXF/PDFと高度CAD機能は未達 |
| OpenDesign/仕様整合 | CONTINUE | 仕様HTMLに沿った画面構成。外部OpenDesign正本は未接続 |
| 正常/空/Error/権限別状態 | CONTINUE | State Reviewと権限切替を実装。実ブラウザE2Eは未実施 |
| Migration/Seed | CONTINUE | SQLあり。実Neon適用未実施 |
| 型検査/Lint/Test/E2E/Build | CONTINUE | lint/a11y/test/build成功。型検査とPlaywright E2Eは未導入 |
| PreviewでUI/API/認証/DB | CONTINUE | Cloudflare PreviewでUI/API/Auth demo確認。DBは`memory-preview`でNeon未接続 |
| Critical/High解消 | CONTINUE | 権限/承認/ロックのCritical相当テストあり。依存脆弱性/Secret ScanのCI Gate未実施 |

## PR / Release 状態

| 項目 | 状態 | 理由 |
| --- | --- | --- |
| PR | OPEN | #15 作成済み |
| Review/Checks | CONTINUE | CodeRabbitがPending |
| 自動マージ | 未実施 | 必須Check/Review、Neon、Preview E2E、Access実設定が未達 |
| 本番Deploy | 未実施 | Merge未完了かつ本番Gate未達 |
| Rollback | 準備済み | Cloudflare Pages Preview単位では直前deploymentへ戻せる。DB破壊的migrationなし |

## Round 3 / 2026-08-26

| 項目 | 内容 |
| --- | --- |
| 対象課題 | Neon実接続、実ブラウザE2E、型検査、CI Gate、Custom Domain/Accessが未達 |
| 変更 | Neon永続化層、Access JWT検証、Idempotency migration、UIからAPI/Neonへの作図・AI・レビュー同期、Playwright/axe、型検査、専用GitHub Actions、運用/Test/トレーサビリティ文書を追加 |
| DB | Neon branch`mirai-web-cad-pr-15`へ専用DBを作成。空DB`mirai_web_cad_verify`は初期0テーブルからMigration/Seedを2回適用し、8テーブル/Seed各1件を確認 |
| Preview | `https://mvp-round-3.mirai-web-cad.pages.dev/`へDeploy。Healthは`db=connected`/`migrated=true`、画面から作図とAI承認後に別リクエストで永続化を確認 |
| Domain/Auth | `mirai-web-cad.mirai-dx-platform.com`のPages Custom Domain、proxied CNAME、専用Access app/policyを作成。未認証302を確認。ProductionはJWT署名/issuer/audience必須、Previewはdemoに分離 |
| 検証 | `npm run verify`成功。15 Unit/API tests、desktop/mobile 8 E2E、axe Critical/Serious 0、Build成功。Gitleaks no leaks、npm audit 0 vulnerabilities |
| 改善 | E2Eで権限拒否ログが再描画されない不具合を検出し修正。Accessメール/クライアントrole信頼を廃止しJWTとサーバーrole mapへ変更 |
| 残存課題 | GitHub Actions実行結果とReview、OpenDesign外部正本照合、本番Merge/Deploy後のHealth/Logs/Error Rate確認 |
| 次Round | commit/push後にPR Checksを監視し、失敗を修正。全Gate成功かつReview条件成立時のみSquash Merge/本番Deployへ進む |

## Round 3 検証結果

| 対象 | 結果 | 証拠 |
| --- | --- | --- |
| Lint/Type/A11y/Unit/Build | PASS | `npm run verify`、15 tests pass |
| Local E2E | PASS | desktop/mobile Chromium 8 tests pass |
| Preview E2E | PASS | Round 3 Previewに対し8 tests pass |
| Canvas visual | PASS | desktop/mobile screenshotとCanvas pixel非空検査 |
| Neon空DB | PASS | 初期0テーブル、2回適用後8テーブル、5レイヤー/4図形Seed |
| Neon永続化 | PASS | UI作図/AI承認後に7図形、3 Command Events、監査6件を別リクエストで確認 |
| Idempotency | PASS | Previewで初回200、同一Key再送は409 |
| Access | PASS（設定） | Custom Domain未認証アクセスがAccess loginへ302。JWT fail-closed Unit test成功 |
| Secret/Dependency | PASS | Gitleaks no leaks、`npm audit` 0 vulnerabilities |
| CI/Review | CONTINUE | workflow追加済み。push後のGitHub Check/Review結果待ち |

## Round 3 Completion Gate

| Gate | 状態 | 根拠 |
| --- | --- | --- |
| 主要業務フロー実操作 | PASS | Preview UIからNeon同期、作図、AI Preview/承認、権限拒否を操作 |
| 要件/設計整合 | CONTINUE | リポジトリ内正本との対応表あり。OpenDesign外部正本は接続情報なし |
| 正常/空/Error/権限別状態 | PASS | desktop/mobile E2Eで確認 |
| Migration/Seed | PASS | 空Neon DBとCI用PostgreSQL手順で2回適用可能 |
| 型検査/Lint/Test/E2E/Build | PASS | 全ローカルGate成功 |
| Responsive/Keyboard/A11y | PASS | desktop/mobile、Keyboard、axe/static検査成功 |
| Preview UI/API/Auth/DB | PASS | demo auth分離、Neon connected、UI経由永続化を確認 |
| Critical/High | PASS（現在証拠） | Gitleaks/npm audit/axeでCritical/Highなし。CI再確認待ち |
| PR/自動マージ/本番 | CONTINUE | PR #15 Checks/Review未完了。本番DeployはGate前のため未実施 |

## Round 4 / 2026-08-26

| 項目 | 内容 |
| --- | --- |
| 対象課題 | Reviewで検出された競合更新、AI提案の出所、XSS、保存データ検証、レイヤー権限、レビュー遷移のCritical/Highリスク |
| 変更 | 図面revisionの比較更新、サーバー保存済みAI提案のみ承認、再帰的安定Hash、非信頼文字列のescape、LocalStorage schema検証、レイヤー更新のTransaction化、pointer cancel復旧、レビュー権限/状態遷移を追加 |
| API/DB | `0003_drawing_revision.sql`を追加。更新・AI承認・レビューAPIはrevisionを検証し、Neonではdrawing更新を単一SQLの比較更新で確定 |
| 検証 | `npm run verify`成功。23 Unit/API tests、desktop/mobile 10 E2E、型検査、静的A11y、Build成功 |
| 追加回帰試験 | OPTIONS 204、未保存AI run拒否、Idempotency重複、古いrevision拒否、レビュー全遷移、URL/保存図面XSS、viewerレイヤー更新拒否を確認 |
| Preview/DB | `https://mvp-round-4.mirai-web-cad.pages.dev/`でdesktop/mobile 10 E2E成功。実Neonでrevision 3から4への更新は200、同一Idempotency-Keyとrevision 3の再更新は409を確認 |
| Migration | 空検証DBとPreview DBの両方で全migration/Seedを2回適用し、8テーブル、Seed 1件、revision列を確認 |
| Production準備 | Neon primary branchに専用DB`mirai_web_cad_production`を作成して全migration/Seedを2回検証。GitHub/Pages production branchを`fix/auth-guard-fail-closed`へ統一し、merge後のみ全検証、Deploy、公開境界smoke testを行うworkflowを追加 |
| 残存課題 | OpenDesign外部正本照合 |

## Round 4 Release / 2026-08-26

| Gate | 状態 | 根拠 |
| --- | --- | --- |
| PR/Review | PASS | PR #15を全Check成功後にSquash Merge。merge commit `043b706` |
| Production CI/CD | PASS | GitHub Actions `Mirai Web CAD Production` run `32926675813`でVerify Release、Pages Deploy、公開境界smoke test成功 |
| Production Deploy | PASS | Pages deployment `bfaa1aae-272b-4700-aa50-48c4e108929b`、branch`fix/auth-guard-fail-closed`、stage`success` |
| Domain/Access | PASS | `mirai-web-cad.mirai-dx-platform.com`はstatus/verification/validationすべてactive。未認証302 |
| API fail-closed | PASS | Pages直URLはSPA 200、`/api/health`未認証401。runtime tailはoutcome`ok`、例外0 |
| Production DB | PASS | Neon専用DB`mirai_web_cad_production`は8テーブル、図面1件、revision列あり。全migration/Seedを2回適用済み |
| OpenDesign | CONTINUE | 外部プロジェクトID/URLまたは接続ツールが現環境にないため、リポジトリ内仕様HTMLを正本として照合 |
