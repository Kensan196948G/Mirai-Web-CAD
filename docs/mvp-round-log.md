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

## Round 5 / 2026-08-26

| 項目 | 内容 |
| --- | --- |
| 対象課題 | 新規作成、Import、CADコマンド入力、Undo/Redoがなく、基本作図がマウス操作に限定されていた |
| 変更 | 空/デモ図面作成、Mirai JSON/ASCII DXF Import、固定コマンドライン、履歴、Undo/Redo、図面全体表示、レイヤ追加Transactionを実装 |
| Command | `LINE/RECT/CIRCLE/PLINE/TEXT/ERASE/MOVE/COPY/UNDO/REDO/SELECT/LAYER/ZOOM/NEW/IMPORT/HELP`を実装。引用符付き文字と座標検証に対応 |
| Import | 10MB/10,000要素を上限とし、JSONとDXFのLINE/CIRCLE/LWPOLYLINE/POLYLINE/ARC/TEXT/MTEXTを構造化パーサでCAD Transactionへ変換 |
| Build | ブラウザ用に`dxf-parser`をesbuildでバンドルし、ローカルサーバーも`dist`と同じ成果物を配信 |
| 公開境界 | Custom DomainのCloudflare Access appを削除し、SPAは全員が未認証で200閲覧可。Worker APIは`AUTH_MODE=access`のfail-closedを維持し、未認証401 |
| 検証 | Type/Lint/static A11y/30 Unit+API/Build成功。desktop/mobile Chromiumの12 E2Eで新規作成、CLI作図、Undo/Redo、JSON Import、axe、狭幅表示を確認 |
| 既知制約 | AutoCAD/Ares Standard完全互換ではない。DWG、DXF書出し、寸法、ハッチ、ブロック、外部参照、レイアウト/印刷は未実装 |

## Round 6 / 2026-08-26 本番運用適合性改善

| 項目 | 内容 |
| --- | --- |
| Monitor | Production SPA公開200/API 401、Access Applicationなし、Neon main未保護/履歴1日、静的security header不足、更新の部分commit可能性を確認 |
| Assessment | 改善前41.5/100、代替率27%、総合PoC。18軸、競合5製品、強み/リスク、25追加機能を評価書・改善台帳へ記録 |
| Development | public health/demoと認証writeを分離、visibility既定private、図面/版/event/監査/Idempotency/AI承認を原子化、CSP/CORS/本文制限、backup/restore、CI recoveryを実装 |
| Database | Migration 0004をPreview/Productionへ適用。実Neon Previewで原子更新`revision=2/audit=2/idempotency=2`を確認し試験レコード削除。mainをprotected化 |
| Verify | 34 Unit/API/性能baseline、desktop/mobile 12 E2E、axe Critical/Serious 0、Lint/Type/Build成功。10k CAD Coreは約0.45秒。隔離Neon DBへ全Migrationを2回適用 |
| Recovery | PostgreSQL 18 custom archive作成/検証、空DB復元、projects/drawings/versions/audits各1件以上を確認。Production実データ復元は未実施 |
| Visual | 1440x1000とiPhone 13 full-page screenshotでCanvas非blank、主要領域の重なり/切れなし。旧MVP表示をUI/デモから除去 |
| Review | 新規Criticalなし。残存CriticalはDWG非対応、Production永続編集SSO不在、案件/図面ACL不在、本番backup/RTO未検証 |
| Completion Gate | PASS。PR #19をsquash mergeし、Production CI、Cloudflare deploy、公開境界smoke testまで成功 |

## Round 6 Release / 2026-08-26

| 項目 | 結果 | 証跡 |
|---|---|---|
| Merge | PASS | PR #19、merge commit `b20340001bc069b45774482e76238b7d3dfbaba1` |
| CI/CD | PASS | GitHub Actions run `32934876851`: Verify Release / Deploy Cloudflare Pages成功 |
| Production | PASS | Cloudflare deployment `7eaa57b7-c7ff-4ac0-89dc-5d8da6e11991`、`mirai-web-cad.mirai-dx-platform.com`へ公開 |
| Public boundary | PASS | SPA / health / public demoは200、任意図面 / writeは未認証401 |
| DB | PASS | Neon production接続、migration適用、main branch保護を確認 |
| Browser | PASS | viewer固定、role selector無効、Canvas描画、desktop/mobile表示を確認 |
| Construction OS影響 | PASS | 別Cloudflare project・別workflowであり、`construction-os.mirai-dx-platform.com`は既存302のまま |
| 残課題 | TRACKED | Entra/RBAC #20、DWG/CAD #21、性能/offline #22、DR/監視 #23、独立repo ADR #24 |

## Round 7 / 2026-08-27 監査・監視・運用強化と正本ディレクトリ確立

| 項目 | 内容 |
| --- | --- |
| Monitor | 本番のSPA/health/demo/write境界を実測し健全を確認。Actions Secrets/Variables API 403(Issue #9)を再確認し、自動デプロイが未稼働である事実を検出 |
| Assessment | 既存評価書(41.5→48.3)をベースラインとして継承し、弱み「監査ログ改ざん防止」「監査exportなし」「監視エンドポイント不足」を本ラウンドの改善対象に選定 |
| Development | ① `0005_audit_log_immutability.sql`: `audit_logs`へDBトリガー2件(UPDATE/DELETE拒否) ② `/api/audit-logs`にlimit/offsetページングと`format=csv` export(数式注入ガード、承認権限のみ、export自体を監査) ③ `/api/health`にstatus/version/timestampとDB異常時503 |
| Database | 本番Neon(`construction-enterprise-os`/main branch/`mirai_web_cad_production`)へ0005を適用し、トリガー2件・INSERT許可・UPDATE/DELETE拒否を実DBで検証 |
| Verify | lint/typecheck/a11y/build PASS、unit 43/43、E2E desktop/mobile 24/24、PostgreSQL 18空DBで0001-0005×2回+トリガー検証、backup/restore drill PASS |
| CI/CD | PR #18をSquash Merge(merge commit `77f71bd`)。CI 4ジョブ(Migration/アプリ/Secret Scan/Recovery)成功。Production workflowはVerify成功、Deployは`CLOUDFLARE_DEPLOY_ENABLED`未設定のためfail-closed skip |
| Release | マージ後、本番Cloudflare Pagesへデプロイ(commit `77f71bd`、deployment `0f0784ac`、production success)。SPA/health/demo 200、write/audit-logs匿名401、healthにstatus/version/timestamp反映を確認 |
| Directory | 正本ディレクトリを`Mirai-Web-CAD`へ統一(旧`Mirai-Web-CAD-Standalone`は移行元としてマーカー保持、HEAD一致確認済み) |
| 残課題 | Issue #9(Actions Secrets 403)による自動デプロイ未稼働、P0-06 SSO、P0-09 合成監視・通知、本番backup自動化、DWG往復、案件RBAC |

## Round 7 検証結果

| 対象 | 結果 | 証拠 |
| --- | --- | --- |
| Lint/Type/A11y/Unit/Build | PASS | 43/43 unit(新規: CSV権限・ガード・ページング2件) |
| E2E | PASS | desktop/mobile 24/24、axe critical/serious 0 |
| Migration 0001-0005 | PASS | PostgreSQL 18空DBで2回適用、8テーブル、トリガー2件、UPDATE/DELETE拒否を機械検証 |
| 本番Neon 0005適用 | PASS | `mirai_web_cad_production`でINSERT許可・UPDATE/DELETE拒否(42501)を実測 |
| backup/restore drill | PASS | custom archive → 空DB復元、projects/drawings/versions/audits各1件一致 |
| GitHub CI | PASS | run `33064297408`(PR #18)4ジョブ成功。Secret Scan no leaks |
| Production | PASS | deployment `0f0784ac`、commit `77f71bd`、公開境界smoke成功 |
| 未実施 | Production実データbackup/restore、100k図形負荷、SSO実利用者E2E、自動デプロイ経路(Issue #9権限待ち) |

## Round 8 / 2026-08-29 監視自動化・バックアップ基盤・CORS強化

土木・建設会社向け本番運用可否の総合評価(CTO全権委任)を起点に、既存の評価書・改善台帳(総合49.0/100、PoC)を継承し、Issue #8(本番バックアップ・監視・障害対応の自動化)のうち自律実行範囲内で完結できる項目を選定・実装した。

| 項目 | 内容 |
| --- | --- |
| Monitor | `gh issue list`/`gh pr list`/`gh run list`で現状確認。Open Issue #5(SSO/RBAC)・#6(DWG往復)・#7(性能/offline)・#8(監視/バックアップ)、Open PR(dependabot 3件、CI全pass)を確認。Neon直接接続用MCPは接続失敗のためGitHub Actions Secrets経由の設計へ切替 |
| Assessment判断 | SSO再構成(Issue #5)は認証方式変更で高リスク変更に該当し、Entra ID管理者権限も未確認のため本ラウンドは対象外。DWG往復(Issue #6)は20〜40日規模のため対象外。Issue #8のうち「合成監視+障害検知」「バックアップ自動化の枠組み」「CORS複数オリジン」を費用対効果の高い実装対象に選定 |
| Development | ① Dependabot PR #2/#3/#4(GitHub Actions依存更新)をCI全pass確認後にbranch更新・squash mergeで統合 ② `.github/workflows/synthetic-monitor.yml`: 15分間隔で公開境界(SPA/health/demo 200、write 401)をPages既定URL/Custom Domain両方で検査し、失敗時`incident`Issue自動起票・復旧時自動close・任意Webhook通知(`MONITOR_WEBHOOK_URL`) ③ `.github/workflows/backup-production.yml`: 日次でNeon本番DBを`pg_dump`しArtifact保存(35日)。`PRODUCTION_DATABASE_URL`未設定時は`ops`Issueを起票してスキップ ④ `src/api-handler.js`のCORSをカンマ区切り許可リスト方式へ変更し、許可リスト外オリジンを反映しない安全な複数オリジン対応(Pages既定URL/Custom Domain両立)に改善 |
| Database | 変更なし(migration追加なし)。DBスキーマ非破壊 |
| Verify | `npm run verify`(lint/typecheck/a11y/unit/build/e2e)全成功。Unit 44/44(CORS許可リストのテスト1件追加)、E2E desktop/mobile 24/24。追加した2つのworkflow YAMLは`yaml.safe_load`で構文検証済み |
| 事前準備 | `incident`ラベル・`ops`ラベルをリポジトリへ作成済み |
| 残課題 | `PRODUCTION_DATABASE_URL` Secret投入(人間承認事項、Neon読み取り専用roleの発行を推奨)、`MONITOR_WEBHOOK_URL`任意設定、当番表・重大度別SLA、Cloudflare/Neon内部5xxログとの相関、案件RBAC(Issue #5)、DWG往復(Issue #6)、SSO再構成(Issue #5、Entra ID管理者権限待ち) |

## Round 8 Release / 2026-08-29

| 項目 | 結果 | 証跡 |
| --- | --- | --- |
| Dependabot統合 | PASS | PR #2(merge `371e408`)、PR #4(merge、`actions/upload-artifact@v7`)、PR #3(base更新競合を`/tmp`隔離clone上で解消、merge)。squash mergeで統合、branchはGitHub側で削除 |
| CodeRabbit | PASS(2件指摘・対応済み) | 1回目レビューでbackup Issue重複作成・synthetic-monitorの誤close懸念を指摘 → dedupeロジック追加で対応。2回目レビューで「タイトル一致だけでは不十分」「旧CORSリスク記述が残存」を再指摘 → `synthetic-monitor`/`backup-automation`専用ラベル導入、評価書の該当行を解消済みに更新。3回目レビューは組織のレビュー上限(spending cap)に到達し`rate limited`。必須4チェックは全pass のため、既対応の指摘内容を確認のうえsquash mergeで進行 |
| Merge | PASS | PR #21、merge commit `c1d3edab58efda4d22139c1acdcadf66d14058e2` |
| CI | PASS | run `33253315955`: Lint/Test/Build/E2E/A11y、Empty PostgreSQL Migration、PostgreSQL Backup and Restore Drill、Secret Scan 全成功 |
| 🚨 Production Deploy | **DEPLOY成功・境界検証FAIL** | run `33253315950`: `Verify Release`成功、`Deploy Cloudflare Pages`のコード配信は成功したが`Verify public boundary`が失敗。手動確認で`/api/health`・`/api/drawings/demo`が両ドメインとも500(`password authentication failed for user 'neondb_owner'`)。SPA(200)・write fail-closed(401)は健全 |
| 障害の先行時期 | 確認 | 同一障害はRound 8の最初のdependabot deploy(PR #2、run `33252235370`、12:20 UTC)から連続4回のProduction run全てで再現しており、本ラウンドのCORS/workflow変更が原因ではないことを示す。直近の正常確認はRound 7(2026-08-27T11:42 UTC) |
| 対応 | ISSUE化・人間対応依頼 | Issue #22を起票。本セッションの`NEON_API_KEY`(Neonプロジェクト`Mirai-Info`のみ参照可)、`CLOUDFLARE_API_TOKEN`(`wrangler pages project list`が`Authentication error`)はいずれも対象プロジェクトへの権限がなく自律修復不可と判断し、Neon資格情報の確認/リセットとCloudflare Pages `DATABASE_URL`更新を人間へ依頼 |
| 評価反映 | 完了 | `production-readiness-assessment.md`の可用性・バックアップを40→25、総合49.4→48.6へ修正し、進行中障害を重大リスクとして追記 |

## Round 8 追補 / 2026-08-29 外部評価アドバイス対応(fail-open是正・CSP修正)

ユーザーが提示した外部評価アドバイス(P0 #1〜#10)を精査し、Mirai-Web-CADのコード変更のみで完結できる範囲(#2〜#4, #5, #7〜#9)をPR #25で実装した。#1(Neon認証復旧)と#10(バックアップSecret投入)はIssue #22と同じ理由で引き続きblocked。#6は`docs/operations.md`のリリース判定基準明記で対応。

| 項目 | 内容 |
| --- | --- |
| 重大発見1 | `checkApiHealth()`がAPI Health手動ボタン押下時のみ実行され、ページロード時は一切API接続を検証していなかった。API未接続時、`roleLocked`が`false`のままロール自己切替が可能で、`changeReviewState()`がサーバー権限を経由せずローカルのみでレビュー提出・承認・新版作成を完了させていた(外部評価の指摘12・13番と一致) |
| 重大発見2 | レイアウト用紙のinline style属性(`style="width:...px;height:...px"`等)が本番CSP(`style-src 'self'`)でブロックされ、computed width/heightが0になっていた。ローカル開発サーバー(`serve-local.mjs`)とE2EテストがCSPヘッダーを一切送信していなかったため、このバグはテストで検出不能だった(外部評価の指摘10・11番と一致) |
| Development | fail-open是正4件(roleLocked、自動health確認、検査不能表示、レビュー/承認/新版ボタンのAPI接続+権限条件disabled化)。CSP修正(CSSOM経由のスタイル設定、`_headers`適用によるローカル/E2Eでの回帰検出)。README/トレーサビリティの3段階表記統一。GitHub Advanced Security全項目有効化。state.json新規作成 |
| Review | CodeRabbit 3ラウンド。用紙サイズがA4/A2/A1選択時も常にA3寸法だった実装漏れ、`_headers`読み込み失敗時のfail-open、SPAフォールバックのキャッシュヘッダー誤付与、監視判定がmainブランチのschedule実行に限定されていない、等の指摘に全て対応 |
| Verify | `npm run verify`全成功。Unit 44/44、E2E **28/28**(用紙サイズ・レイアウトサイズ検証テストを新規追加) |
| Merge | PR #25、merge commit `13935ef` |
| Production | Verify Release成功、`Verify public boundary`はIssue #22(未解消)により引き続き失敗。本PRの変更起因ではないことを確認 |

## Round 9 / 2026-08-30 Neon PostgreSQL依存の完全除去(ローカルPostgreSQL + Cloudflare Tunnel移行)

ユーザーから「Neonは今後2度と利用しない、削除してほしい」「Mirai-Web-CAD、CivilDraft-Web-CADも両方残す」「本番機は`https://mirai-web-cad.mirai-dx-platform.com/`のまま」との明示的な指示を受け、Issue #22(Neon DB認証失敗)の根治対応として、アーキテクチャそのものをNeon非依存へ移行した。姉妹プロジェクトCivilDraft-Web-CADは調査対象からも変更対象からも除外(ユーザー指示による)。

| 項目 | 内容 |
| --- | --- |
| Monitor/Plan | EnterPlanModeで計画立案。3件のExplore調査(Neon依存範囲の実測、CivilDraftのsystemd/Tunnelパターン、ローカルPostgreSQL環境の実測)+ 1件のPlan設計を並列実行し、実装計画を`.claude/plans/proud-wandering-glade.md`として確定・ユーザー承認を得た。調査で判明した重要な訂正: 想定していたポート18811は他プロジェクト使用中のため18812を採用、CivilDraftの`IPAddressDeny=any`設定をそのまま踏襲すると本番のCloudflare Access JWKS取得がブロックされ全書き込みAPIが恒久401になることが判明し不採用とした |
| Development(Phase 1、PR #29) | `src/data-store.js`を`@neondatabase/serverless`から`postgres`(postgres.js)へ全面書き換え(tagged templateは無変更、`sql.transaction`を`sql.begin`へ、モジュールレベルでの接続プールメモ化を追加)。`scripts/serve-production.mjs`新規(常時稼働本番サーバー、必須環境変数のfail-fast検証、起動時DB probe、graceful shutdown、本文サイズ上限)。`scripts/lib/http-bridge.mjs`で共通ロジック抽出。`tests/data-store.pg.test.js`新規(`TEST_DATABASE_URL`かつDB名に"test"を含む場合のみ実行、本番DBへの誤書込みを防止)。systemdユニット6種・Cloudflare Tunnel config例・`deploy-local.sh`/`backup-local.sh`/`check-backup-freshness.sh`を追加 |
| Review | CodeRabbit 3ラウンド、計8件の指摘全てに対応(監査トリガー判定の見落とし、タイムゾーン未指定、本文サイズ無制限によるメモリ枯渇リスク、個人情報のログ出力、本番DBへの統合テスト誤書込みリスク、ストリームdestroy順序による413応答未達等)。特に本文サイズ制限の実装では、CodeRabbitが提示したNode.js `Readable.prototype.resume()`の内部動作の指摘を受け、`req.iterator({ destroyOnReturn: false })`のクリーンアップ完了後に`resume()`を呼ぶよう2段階で修正し、再現テストで検証した |
| Database(Phase 0) | ローカルPostgreSQL 16(このホスト常駐)に専用DB`mirai_web_cad`・ロール`mirai_web_cad_app`・バックアップ用読み取り専用ロール`mirai_web_cad_backup`を作成。migration 0001〜0005を適用(8テーブル、seed 1件、監査トリガー2件を確認) |
| Infrastructure(Phase 2) | systemdユニット6本(`mirai-web-cad.service`、`mirai-web-cad-cloudflared.service`、バックアップ・鮮度チェックのtimer×2組)を配置・起動。Cloudflare Tunnel(`mirai-web-cad`)を新規作成しコネクタ4本を登録(この段階ではDNS未変更、公開影響ゼロを維持) |
| Release(Phase 3、★高リスク) | ユーザーがCloudflare Pages Custom Domainを解除、DNSレコード消失を3つのリゾルバ(system/1.1.1.1/8.8.8.8)で独立確認後、ユーザーの明示的なY/N承認を得て`cloudflared tunnel route dns`を実行。本番実測でSPA 200、`/api/health` 200(`provider:postgres, mode:connected, migrated:true`)、demo 200、write 401(fail-closed)を確認 |
| CI/CD(Phase 4) | `production.yml`のdeployジョブ(Cloudflare Pages)を削除しverifyのみに縮小。`ci.yml`のmigrationジョブをpostgres:16-alpineへ統一、`postgres-integration`ジョブを新設(TEST_DATABASE_URL経由の統合テスト)。`synthetic-monitor.yml`から`pages.dev`向け4チェックを削除(Custom Domainのみ監視)。`backup-production.yml`(GitHub Actions版、未稼働だった)を削除 |
| Incident | 作業中に`~/.config/mirai-web-cad/production.env`をcatで直接画面出力し、DBパスワードを誤って露出させた。直ちにロールのパスワードをローテーションして対応。以後は`grep -o '^KEY='`等でキー名のみ確認する方針に変更(state.json learningへ記録) |
| Verify | `npm run verify`全成功。`TEST_DATABASE_URL`設定時のnpm testで統合テスト7件を含む51件成功、本番用`DATABASE_URL`設定時は統合テストが実行されないことを確認(誤書込み防止の実効性を検証) |
| 事後対応 | Issue #22を解決としてclose。改善台帳P0-07(Neon main保護)を失効、P0-12(バックアップ自動化)を完了、P0-19(本項目)を新規完了として記録。`docs/operations.md`/`README.md`/`docs/api-db.md`/`docs/testing.md`/`SECURITY.md`のNeon関連記述を本番アーキテクチャに合わせて更新 |
| 残課題 | Cloudflare Accessアプリ未作成のため書き込みAPIは全てfail-closedで401(Issue #5、別途対応)。当番表・重大度別SLA未整備(Issue #8残課題)。ソーク運用(1〜2週間)後にCloudflare Pages関連ファイル削除・Neonプロジェクト自体の削除(人間実施)を予定 |

## Round 9 追補 / 2026-08-30 Cloudflare Access新設(書き込みAPIの永続編集経路を復旧)

ユーザーから「実行願います」との承認を得て、Round 9の残課題だったCloudflare Access未設定に着手した。「認証方式・認可モデルの変更」に該当する高リスク操作のため、事前に適用方針(保護対象path、ログイン方式)をAskUserQuestionで確認してから実施した。

| 項目 | 内容 |
| --- | --- |
| 事前調査 | Cloudflare公式ドキュメントで、Access保護下の非ブラウザクライアント(curl等)は既定で`302`を受け取る(401ではない)ことを確認。Managed OAuth機能で`401`+`WWW-Authenticate`にできるが、独自OAuthサーバー運用時は非推奨との注記があり、既存のapi-handler.js独自JWT検証と整合しないため見送り |
| 権限確認 | 既存の`CLOUDFLARE_API_TOKEN`(Pages Edit限定)ではZero Trust organizations取得が403だったため、より広い権限を持つCloudflare公式MCP(`mcp__cloudflare-api`)経由で実施。team domain(`winter-lake-f4c9.cloudflareaccess.com`)、IdP(Cloudflareビルトイン、One-Time PINのみ、Entra ID等の外部IdP未連携)、既存33アプリの設定パターン(CivilDraft-Web-CAD含む、全て`kensan1969@gmail.com`のみallowの単純構成)を確認した |
| Development | Access Application 3件を作成: ①`/api/health`bypass(everyone) ②`/api/drawings/demo`bypass(everyone) ③`/api/*`保護(allow `kensan1969@gmail.com`)。`options_preflight_bypass`を有効化しCORSプリフライトの通過を確認。本番`.env`のダミー値(`CF_ACCESS_TEAM_DOMAIN`/`CF_ACCESS_AUD`/`ACCESS_ROLE_MAP`)を実値へ更新しサービス再起動。`synthetic-monitor.yml`のwrite判定を「302または401で成功」に緩和 |
| Verify | 本番実測: SPA/health/demo 200(bypass維持を確認)、未認証write 302(Accessログインへのリダイレクト)、不正JWTヘッダー付きwriteも302(エッジでのCookie検証が先行、アプリ層に到達しない多層防御を確認)、実ブラウザ形式のCORSプリフライト(Origin+ACR-Method付きOPTIONS)は204 |
| Review | 評価書のSSO関連リスクを一部解消として更新、セキュリティスコア63→66(総合49.7→49.9)。改善台帳P0-06を一部完了に更新 |
| 残課題 | ログイン方式はOne-Time PINのみ(Entra ID/HENNGE ONE連携は別途)。許可対象は`kensan1969@gmail.com`のみ(複数利用者・組織ロール展開は未着手、Issue #5継続) |



## Round 10 / 2026-09-04 機能カタログ受領・Round 1(DXF書出し実装とカタログ監査)

ユーザーから「理想的な建設・土木2D CAD機能カタログ」(基本作図/精密編集/座標、土木専門機能、図面標準・SXF・電子納品、注記・数量・属性、GIS・点群、BIM/CIM・4D/5D、CDE・権限、自動化・AI、品質照査、セキュリティ・運用の全章)を全機能追加する方針の指示を受領。8 Round構成のGoal Round 1として、(1)カタログ×現行実装の監査(確認)、(2)最優先ギャップであるDXF書出しの実装、を実施した。

| 項目 | 内容 |
| --- | --- |
| 確認(監査) | `docs/feature-catalog-coverage.md`を新規作成。カタログ全章(A〜M)の各項目を実装済み✅/限定対応◐/実装予定🚧/未着手⬜/恒久対象外⊘へ分類し、方針文書Phase・改善台帳ID・既存コードへ対応付け。最優先(正確な2D作図/寸法/レイヤ/PDF、DXF往復、版管理/承認)はPhase 1〜2、土木専門機能はPhase 4、CDE/AI/GISはPhase 2〜5+中長期と判定 |
| Development | `src/dxf-export.js`を新規実装(ASCII DXF R2000系: HEADER($ACADVER/$INSUNITS)+TABLES(LAYER,色は近傍ACIへ近似)+ENTITIES+EOF)。対応entity: line→LINE、circle→CIRCLE、polyline→LWPOLYLINE(閉鎖70=1)、rect→閉鎖LWPOLYLINE(4頂点)、text→TEXT(高さ40)。dimension/hatch/blockは「黙って捨てず」skipped(型・ID・理由)へ構造化報告し、存在しないレイヤー参照も同様に報告。座標は1e-9丸め、改行textは空白化+warning。`src/storage.js`に`exportDxfFile`、リボン「出力」にDXF書出しボタン(`exportDrawingDxf`)を追加 |
| CLI | `scripts/compat-report.mjs --mode=dxf-roundtrip`を実動化(従来はexit code 2のスタブ)。DXF→import→export→importの往復を`compareDrawings`9軸で採点し、実装完了基準(P1-03a: dxf-roundtripで合格スコア)を測定可能にした |
| 検証 | `npm run verify`全成功(lint/typecheck/a11y/unit 158 pass+1 DB skip/build、**e2e 46件**=desktop+mobile、新規DXF書出しダウンロード検証2件を含む)。`tests/dxf-export.test.js`9件新規(構造・entity別エンコード・rect→LWPOLYLINE・skipped報告・改行・ACI近似・往復一致・座標丸め)。`tests/compat-report.test.js`のdxf-roundtripテストを「--file必須+合格スコア返却」へ更新 |
| 文書 | README(Import行・CAD互換範囲・関連文書)、`docs/compat-scope-and-scoring.md`(必須範囲#1と測定不能表)、`docs/improvement-register.md`(P1-03に2026-09-04追記)、`state.json`(goal/P0-43/kpi)を更新 |
| 残課題 | dimension/hatch/blockのDXF書出し、真色420・線種・線幅の保持、レイアウト/図枠/表題欄の保持、精密編集(TRIM/EXTEND/OFFSETの幾何精度)、寸法スタイル、レイヤーテンプレート等は次Round以降(改善台帳P1-02〜P1-06、方針文書Phase 1) |

## Round 10 追補 / 2026-09-04 機能カタログRound 2(OSnap拡張: 中点・交点・垂線・近接点)

ユーザー指示(DB移行確認)は既にP0-19で完了済みのためスキップ。Goal Round 2として、カタログA-2「高精度編集: 端点・中点・交点・垂線・接線・近接点・グリッド等へのオブジェクトスナップ」のうち未対応だった部分を実装した。

| 項目 | 内容 |
| --- | --- |
| Development | `src/cad-draft-helpers.js`を拡張: `entitySegments`(line/rect/polyline/hatch/dimensionの線分分解)、`closestPointOnSegment`(線分上の最近点)、`perpendicularFoot`(垂線の足、区間外はnull)、`segmentIntersection`(交差点、共有端点・平行はnull)、`OSNAP_MODES`(endpoint/midpoint/center/quadrant/intersection/perpendicular/nearest)、`DEFAULT_OSNAP_MODES`(既定: 端点/中点/中心/四分点/交点ON、垂線/近接点OFF)。`findOsnapPoint`をモード別候補選択へ改修し、交点は可視エンティティ間のみ・同一entity自己交差を除外、戻り値は従来契約の座標のみを維持 |
| UI | `src/app.js`: DEFAULT_USER_SETTINGSへ`osnapModes`追加、設定ダイアログ「作図補助」に「OSnap対象」チェックボックス群(OSNAP_MODE_LABELS)、`sanitizeOsnapModes`(保存値の検証)と`osnapModesFromForm`(フォーム読取)を新設、`snapPoint`から選択モードを渡す。LocalStorageへ永続化(loadUserSettings/saveUserSettings対応) |
| 検証 | unit 170件(新規10件: セグメント分解/最近点/垂線の足/交点/共有端点除外/モード既定値/中点・交点・垂線・近接点スナップ/モード無効化)、e2e 48件(新規2件: OSnap対象の選択・保存・再読込)。`npm run verify`全成功 |
| 文書 | README(作図補助行)、`docs/feature-catalog-coverage.md`(OSnap行・点/交点行)、`docs/improvement-register.md`(P0-44)、`state.json`(goal/P0-44/unit 170/e2e 48)を更新 |
| 残課題 | 接線(tangent)スナップ、極トラッキング・追跡線、OSnapの空間インデックス最適化(現状は全可視entity走査)、正確なTRIM/EXTEND/OFFSET、MIRROR/ARRAY等の編集コマンド、寸法スタイル等は次Round以降(方針文書Phase 1、改善台帳P1-02〜P1-06) |
