# 改善台帳

更新日: 2026-08-30(前回 2026-08-29)。工数は1人日=実働8時間の概算であり、調達・契約・UAT待ちは含めない。

**優先順位の最上位参照文書**: [80～90％代替・AI統合開発方針](Mirai-Web-CAD_80-90％代替・AI統合開発方針.md)(2026-08-30、ユーザーがCTOへ対応・開発・実装を全権委任)。現状代替率30-35%、土木2Dワークフロー限定で80-90%到達を目標とするPhase 0-5ロードマップを定義。DWG往復・精密CAD Core・尺度保証PDFを最優先とし、AI機能拡張より先にCAD基盤の完成を優先する方針。本台帳のP1-03(DWG)・P2-01(性能)・P1-06(レイアウト/PDF)等は、この方針のPhase 1(80%到達の必須範囲)に対応する。

## 今すぐ

| ID | 内容 | 理由/対象 | 効果 | 難易度・工数 | 優先度 | 依存/リスク | 完了基準 | 状態 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| P0-01 | 匿名閲覧と更新認証を分離 | 全利用者/権限逸脱防止 | 公開性と機密性を両立 | 中 3日 | P0 | Access設計 | public図面のみ200、全writeはfail-closed(2026-08-30〜Cloudflare Access保護によりエッジ層302、アプリ層到達時401) | 完了 |
| P0-02 | DB更新の原子化 | CAD担当/データ不整合防止 | 図面・版・監査・冪等性を同時確定 | 高 4日 | P0 | Neon SQL | 障害時に部分更新なし | 完了 |
| P0-03 | CSP等の配信header | 全利用者/XSS・clickjack低減 | browser防御 | 低 1日 | P0 | CSP回帰 | Header実測、E2E成功 | 完了 |
| P0-04 | JSON 1 MiB/Content-Type/CORS制限 | 運用/濫用低減 | API資源保護 | 低 1日 | P0 | 大容量Import方式 | 413/415/CORS test | 完了 |
| P0-05 | backup/restore drill | 運用/消失対策 | 手順の機械検証 | 中 2日 | P0 | PG client | 空DB復元と件数検証 | 完了 |
| P0-06 | Entra ID + Cloudflare Access再構成 | 社員/永続編集 | SSO/MFA/RBAC | 中 3-5日 | P0 | IdP管理者、HENNGE方針 | 社員3roleでE2E | 一部完了(2026-08-30): Cloudflare Access Application(`mirai-web-cad-api`、`/api/*`保護、One-Time PIN、`kensan1969@gmail.com`のみallow)を新設し、管理者本人による書込み動作を確認。Entra ID/HENNGE ONE連携、複数利用者・roleマッピングの本格運用は未着手 |
| P0-07 | ~~Neon main保護・復旧窓延長~~ | ~~運用/誤削除防止~~ | ~~RPO改善~~ | — | — | — | — | **失効(2026-08-30)**: 2026-08-30にNeon PostgreSQL依存を完全に除去しローカルPostgreSQL + Cloudflare Tunnelへ移行したため、Neon側の保護設定は対象外になった。RPO/RTOはP0-12(ローカルバックアップ自動化)で別途管理する |
| P0-08 | Production環境承認Gate | CTO/誤deploy防止 | 変更統制 | 低 1日 | P0 | GitHub権限 | reviewer必須、rollback確認 | 一部完了: branch protection必須check4件。required reviewerはプラン制約(Issue #9) |
| P0-09 | 合成監視・通知 | IT/DX 7名 | 発見時間短縮 | 中 2日 | P0 | 通知先 | 5分監視、health/demo/write境界alert | 一部完了: healthにstatus/version/timestamp/503を実装(2026-08-27)。GitHub Actions 15分間隔の合成監視+`incident`+`synthetic-monitor`両ラベルIssue自動起票+復旧時自動close、Webhook通知(`MONITOR_WEBHOOK_URL`任意設定)を実装(2026-08-29、CodeRabbitレビュー対応で誤close防止の専用ラベルを追加)。重大度定義・SLA目標・エスカレーション経路・当番表テンプレートを`docs/operations.md`に追加(2026-08-30)。schedule実行間隔はGitHub仕様上の保証なし、**当番の実名割当(人手入力待ち)**とCloudflare/Neon内部5xx相関は未着手 |
| P0-10 | 監査ログのDB追記専用化 | 監査者/改ざん防止 | 権限保有者でも改変不可 | 低 0.5日 | P0 | 0005 migration | トリガー2件、UPDATE/DELETE拒否をCI・本番で検証 | 完了 (2026-08-27) |
| P0-11 | 監査ログCSV export・ページング | 監査者/説明責任 | 監査データの棚卸が可能 | 低 1日 | P1 | 数式注入対策 | `?format=csv`が承認権限のみ、export自体を監査 | 完了 (2026-08-27) |
| P0-12 | 本番バックアップ自動化 | 運用/RPO改善 | 日次archiveの機械実行 | 低 1日 | P0 | ローカルPostgreSQLへの移行(P0-19) | 日次バックアップ成功、鮮度検証成功 | **完了(2026-08-30)**: Neon依存の除去に伴いGitHub Actions版(`backup-production.yml`)を廃止し、`mirai-web-cad-backup.timer`(systemd、日次03:10 JST、読み取り専用ロール使用)+`mirai-web-cad-backup-check.timer`(鮮度検証06:00 JST)へ全面移行。実機で動作確認済み |
| P0-19 | Neon PostgreSQL依存を完全除去 | 全利用者/ユーザー指示への対応 | ローカルPostgreSQL + Cloudflare Tunnelへ本番永続化を移行 | 高 1日 | P0 | ローカルPostgreSQL稼働、Cloudflare Tunnel権限 | **現行の本番経路(`scripts/serve-production.mjs`→ローカルPostgreSQL)にNeon依存が無いこと**。本番`/api/health`が`provider=postgres, mode=connected`を返すことで確認する(ロールバック用に残置しているCloudflare Pages `functions/api/`側のコードはこの基準の対象外。Phase 7でPages自体を削除する際に合わせて整理する) | **完了(2026-08-30)**: `src/data-store.js`を`postgres`(postgres.js)へ書き換え、`scripts/serve-production.mjs`新規、systemd化、Cloudflare Tunnel作成、DNS切替まで実施。本番実測でSPA/health/demo 200、write 401を確認。Issue #22はこれにより解決としてclose |
| P0-13 | CORS複数オリジン対応 | 運用/Pages既定URLとCustom Domain両立 | 許可リスト外オリジンは反映しない安全な多origin対応 | 低 0.5日 | P1 | 既存単一origin利用者への影響確認 | 許可リスト内originのみ反映、リスト外は既定originを返すテストで確認 | 完了 (2026-08-29) |
| P0-14 | API未接続時のfail-open是正 | 承認者/整合性 | 検査OK誤表示・ロール自己切替・ローカル完結承認を排除 | 中 1日 | P0 | 外部評価アドバイスの指摘(P0 #2〜#4) | roleLocked fail-safe化、検査不能表示、レビュー/承認/新版ボタンをAPI接続確認済みかつ権限ありのみ活性化 | 完了 (2026-08-29) |
| P0-15 | レイアウト崩壊・CSP不整合の修正 | CAD担当/表示破綻防止 | inline styleのCSPブロックによるcomputed width/height=0を解消 | 中 1日 | P0 | 外部評価アドバイスの指摘(P0 #5) | CSSOM経由の動的スタイル設定へ変更。serve-local.mjsに`_headers`適用を追加しローカル/E2Eで回帰検出可能に | 完了 (2026-08-29) |
| P0-16 | README/トレーサビリティの実態同期 | 全利用者/文書正本の信頼性 | 「実装済み」一辺倒表記を試作/限定対応/実案件認定済みの3段階へ統一 | 低 0.5日 | P0 | 外部評価アドバイスの指摘(P0 #7) | 機能表に段階列と実装限界の注記を追加 | 完了 (2026-08-29) |
| P0-17 | GitHub Advanced Security機能有効化 | セキュリティ/供給網統制 | vulnerability alerts, secret scanning, push protection, private vulnerability reporting, dependabot security updatesを有効化 | 低 0.1日 | P0 | Publicリポジトリのため無償 | `security_and_analysis`全項目enabled、vulnerability-alerts/private-vulnerability-reporting enabled | 完了 (2026-08-29) |
| P0-18 | state.json整備 | 運用/セッション間の状態継承 | goal・blocked_issues・learningを機械可読で記録 | 低 0.2日 | P1 | 外部評価アドバイスの指摘(P0 #8) | state.json新規作成、Issue #22等のblockerを記録 | 完了 (2026-08-29)。専用GitHub Projects(v2)の整備は未着手 |
| P0-21 | CI `Deploy Preview`ジョブの`Verify preview`が恒常的に失敗 | 運用/CI可読性 | PR毎に赤いジョブが残り、真の異常との判別を妨げる | 低 0.5日 | P2 | Pages Functions側のNeon接続コード | PR CIで`Deploy Preview`がgreenになる、またはNeon依存の実態に合わせてチェック内容を見直す | 未着手(2026-08-30発見、PR #29〜#32で継続確認): Cloudflare Pages Functions(`functions/api/`)がNeon移行前のコードのまま残置されているため、`.github/workflows/ci.yml`の`Verify preview`ステップ(`$PREVIEW_URL/api/health`が200であることを確認)が構造的に失敗する。required status checksには含まれておらずマージはブロックしないが、放置するとCI失敗が常態化し真の回帰と見分けにくくなるリスクがある。対応候補: (a) `Verify preview`からNeon依存の`/api/health`アサーションを外しSPA 200のみ確認、(b) Phase 7でPages `functions/api/`自体を削除する際に合わせて解消 |
| P0-22 | 閲覧者ロールのUIボタン活性化制御 | 全利用者/権限UXの明確化 | 80-90%方針§12直近アクション#1「閲覧者でも新規、保存、作図、移動、削除等のボタンが有効」の是正、80-90%方針§6.5「権限不足の理由を表示する」 | 低 1日 | P0 | ROLE_POLICIES.canEdit/canApprove | 閲覧者ロールで新規図面/保存/開く/作図・修正・注釈系リボンボタンがdisabledかつtitle/aria-labelに理由表示、選択・計測・表示系は引き続き有効 | 完了(2026-08-30、CodeRabbitレビュー対応込み): `src/app.js`の`ribbonButtonHtml`にtool/act種別からcanEdit/canApprove要否を判定する`ribbonButtonDisabled`を追加。`newDrawingBtn`/`importBtn`/`quickSaveBtn`にも同条件を適用し、disabled時はtitle/aria-labelへ「（〇〇は利用できません）」を付加。サーバー側のfail-closed(P0-14)は既存のまま無変更、UI層の追加防御。E2E回帰テストを更新(disabled状態の検証) |
| P0-23 | A4/A3レイアウトプレビューの未保存不整合 | CAD担当/レイアウト作業の信頼性 | 80-90%方針§12直近アクション#3「A4選択とA3横プレビューが同時に表示される場合がある」の是正 | 低 1日 | P0 | `#layoutForm`のinput/change、`state.layoutDraft` | 用紙サイズ変更が「設定保存」を押す前でもプレビュー(サイズ・ラベル)へ即時反映され、印刷・空間切替・タブ切替後も未保存値が保持される | 完了(2026-08-30、CodeRabbitレビュー対応込み): `previewLayoutFromForm`が`state.layoutDraft`へ未保存フォーム値を保持し、`activeLayoutDrawing()`経由で`layoutSpaceHtml`/`applyLayoutGeometry`/`printDrawing`が同じdraft値を参照するよう修正(当初はDOMのみの一時更新で、印刷・タブ切替時に保存済み値へ戻る不具合があった)。「設定保存」成功時・新規図面作成時にdraftをクリア。回帰E2Eテスト追加(A4/A3/A1切替、空間切替後の保持) |
| P0-24 | `deploy-local.sh`のhealth check grepが常時不一致 | 運用/本番反映の信頼性 | 80-90%方針§12直近アクション#7「最新mainの承認型本番反映」作業中に発見。正常デプロイでも毎回自動ロールバックしていた | 低 0.1日 | P0 | なし | health checkのgrepが整形済みJSONにマッチする | 完了(2026-08-30、PR #35): `grep -q '"ok":true'`(スペースなし厳密一致)を`grep -qE '"ok":[[:space:]]*true'`へ修正 |
| P0-25 | 保存正本(サーバ/ブラウザ一時/未同期/競合)の統一表示 | 全利用者/正本の明確化 | 80-90%方針§12直近アクション#4「サーバ正本、ブラウザ一時保存、未同期、同期済み、競合、オフラインを常時表示すべき」への対応 | 中 2日 | P0 | 保存状態stateの新設設計 | 単一の状態指標(saved-local/synced/unsynced/conflict/offline等)をヘッダーまたは設定に常時表示 | 未着手(2026-08-30): 現状`system-summary`(保存先表示)と`state.apiStatus.message`(同期状態)が別々の文言で並記され正本が不明瞭(サブエージェント調査で確認)。統一state設計とUI統合が必要な中規模タスクのため次セッション以降で着手 |

## 3か月以内

| ID | 内容 | 対象/効果 | 難易度・工数 | 優先度 | 依存/リスク | 完了基準 |
| --- | --- | --- | --- | --- | --- | --- |
| P1-01 | 案件/組織/図面ACL | 全利用者/最小権限 | 高 15日 | P0 | Entra group、DB設計 | 横断IDOR test、監査、管理手順 |
| P1-02 | 案件・図面一覧/検索 | 現場・本社/主要flow | 中 10日 | P1 | P1-01 | empty/error/page test、1万件検索 |
| P1-03 | DWG/DXF round-trip engine選定 | CAD担当/正本互換 | 高 20-40日 | P0 | SDK契約・license | 実案件100図面の許容差合格。**一部完了(2026-08-30)**: 選定ADR([ADR-0001](adr/ADR-0001-dwg-dxf-roundtrip-engine.md))作成。ハイブリッド案(DXF正本+ODA File Converter CLIブリッジ、短期)とODA Drawings SDK正式契約(中期候補)を推奨、P1-03a〜dへサブタスク分解。**CodeRabbitレビュー対応でODA File Converterの商用利用許諾取得を実装着手の前提条件として明記、P1-03cの受入条件にentity/layer/layout保持を追加**。契約・実装着手は人間承認待ち |
| P1-04 | 寸法・公差・尺度 | CAD担当/日常作図 | 高 15日 | P1 | CAD kernel | linear/aligned/angular test、PDF一致 |
| P1-05 | hatch/block属性 | CAD担当/図面標準 | 高 20日 | P1 | DWG model | round-trip、編集、異常系 |
| P1-06 | layout/plot/PDF | CAD担当・承認者/成果物 | 高 20日 | P0 | font/plot style | A1-A4、尺度、線幅、font受入 |
| P1-07 | autosave/crash recovery | CAD担当/消失防止 | 高 12日 | P0 | IndexedDB暗号化 | 30秒以内復元、競合処理test |
| P1-08 | 版比較・差分承認 | 承認者/説明性 | 中 10日 | P1 | command event | add/update/delete可視化、署名監査 |
| P1-09 | 管理UI・利用者/role | IT/DX/少人数運用 | 中 10日 | P1 | P1-01 | group同期、棚卸export、異常系 |
| P1-10 | SBOM/License/Security/CODEOWNERS | CTO/供給網統制 | 低 3日 | P1 | 法務方針 | CI生成、責任者、脆弱性窓口 |

## 6～12か月

| ID | 内容 | 対象/効果 | 難易度・工数 | 優先度 | 依存/リスク | 完了基準 |
| --- | --- | --- | --- | --- | --- | --- |
| P2-01 | 100k図形描画/空間index/Web Worker | CAD担当/性能 | 高 30日 | P0 | kernel | p95入力100ms、30fps、長時間test。**一部着手(2026-08-30)**: `drawCanvas`にviewportカリング(`boundsIntersect`/`entityBounds`、`src/cad-core.js`・`src/app.js`)を実装し、可視範囲外の図形描画を省略。描画コストのみ改善で、`hitTest`・`entities.find`等のO(n)検索(選択・ドラッグ・ID参照)は未対応。空間index(quadtree/rbush等)導入、差分描画、Web Worker化は未着手。残作業は大規模改修のため別途スコープ確定が必要 |
| P2-02 | PWA/offline閲覧・markup | 現場/通信断対応 | 高 25日 | P1 | 暗号・同期設計 | 8時間offline、再同期競合test |
| P2-03 | SharePoint/OneDrive連携 | 全社/M365正本連携 | 高 20日 | P1 | Graph API/retention | ACL継承、version、DLP確認 |
| P2-04 | 協力会社secure share | 協力会社/配布削減 | 高 15日 | P1 | B2B/期限 | 期限・透かし・download監査 |
| P2-05 | 電子納品命名/属性検査 | 公共工事/手戻り削減 | 中 15日 | P1 | 国交省最新要領 | 年版管理、一次資料link、受入test |
| P2-06 | 座標系/測地系/GIS layer | 土木技術者/位置整合 | 高 30日 | P1 | EPSG/国土地理院条件 | CRS明示、変換誤差、出典lineage |
| P2-07 | API/webhook/Excel export | DX/連携 | 中 15日 | P2 | ACL/API version | OpenAPI契約、rate limit、監査 |
| P2-08 | data quality dashboard | 管理者/品質監視 | 中 12日 | P1 | ルール定義 | 欠損・重複・揺れ・取得失敗alert |

## 将来

| ID | 内容 | 対象/効果 | 難易度 | 優先度 | 完了基準 |
| --- | --- | --- | --- | --- | --- |
| P3-01 | ACL付き仕様書/過去図面RAG | 技術者/検索短縮 | 高 | P2 | 出典・版・page・信頼度、権限test |
| P3-02 | 図枠/注記/属性の構造化抽出 | CAD担当/転記削減 | 高 | P2 | 精度指標、human correction、監査 |
| P3-03 | 数量・尺度・座標異常候補 | 承認者/見落とし低減 | 高 | P2 | 再現率/誤検知、責任分界、停止手段 |
| P3-04 | BIM/IFC参照と2D切出し | 技術者/連携 | 高 | P3 | IFC版、座標、属性保持test |
| P3-05 | Sheet Set/外部参照 | CAD担当/大規模案件 | 高 | P2 | path解決、版固定、offline test |

## 追加機能分類（25件）

| 分類 | 機能 | 対象 | 効果 | 難易度 | 優先度 | 差別化 |
| --- | --- | --- | --- | --- | --- | --- |
| 業務 | 案件/工区/図面台帳 | 全社 | 正本所在統一 | 中 | P0 | 土木案件階層 |
| 業務 | レビュー差戻し/comment | 承認者 | 手戻り明確化 | 中 | P1 | 社内決裁統合 |
| 業務 | 図面配布/受領確認 | 現場/協力会社 | 配布証跡 | 中 | P1 | 工区別配布 |
| 地図 | CRS/測地系変換 | 土木技術者 | 座標事故防止 | 高 | P1 | 日本測地系運用 |
| 地図 | 国土地理院layer | 現場 | 現況把握 | 中 | P2 | 一次情報lineage |
| 検索 | 図面/属性/全文検索 | 全社 | 探索時間削減 | 中 | P1 | 案件ACL検索 |
| 可視化 | 版差分overlay | 承認者 | 変更把握 | 中 | P1 | 承認証跡連動 |
| Mobile/PWA | 現場markup | 現場 | 帰社転記削減 | 高 | P1 | 写真/位置/図面連動 |
| Offline | 暗号化offline cache | 現場 | 通信断対応 | 高 | P0 | 現場同期policy |
| 通知 | review/期限通知 | 承認者 | 滞留削減 | 低 | P1 | Teams/Exchange連携 |
| PDF/Excel | 尺度付きPDF plot | CAD担当 | 成果物作成 | 高 | P0 | 発注者図枠preset |
| PDF/Excel | 数量Excel export | 積算/現場 | 転記削減 | 中 | P1 | 工種別template |
| API | OpenAPI + webhook | DX | 自動連携 | 中 | P2 | M365/台帳接続 |
| RBAC/監査 | 案件ACL | 管理者 | 権限逸脱防止 | 高 | P0 | Entra group同期 |
| RBAC/監査 | 監査export/保全 | 監査者 | 説明責任 | 中 | P0 | 保存年限policy |
| 管理運用 | 利用者/role棚卸 | IT/DX | 7名運用 | 中 | P1 | 差分承認 |
| 管理運用 | SLO/alert dashboard | IT/DX | 障害短縮 | 中 | P0 | 主要flow監視 |
| データ品質 | 欠損/重複/表記揺れ検査 | 管理者 | 品質維持 | 中 | P1 | 自治体別rule |
| データ品質 | 取得lineage/利用条件 | 管理者 | 出典説明 | 中 | P1 | 一次情報優先 |
| 土木固有 | 電子納品check | 公共工事担当 | 不備削減 | 高 | P1 | 要領年版管理 |
| 土木固有 | 土工数量/測点 | 技術者 | 計算時間削減 | 高 | P2 | 断面・測点連携 |
| 土木固有 | 図枠/工種template | CAD担当 | 標準化 | 中 | P1 | 社内標準preset |
| AI | ACL付きRAG | 技術者 | 検索・判断支援 | 高 | P2 | 根拠引用 |
| AI | 図面属性抽出 | CAD担当 | 転記削減 | 高 | P2 | human correction学習 |
| AI | 異常候補検出 | 承認者 | 見落とし低減 | 高 | P2 | rule+model説明 |
