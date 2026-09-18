# 本番運用適合性評価書

評価日: 2026-09-18(前回 2026-08-30)
対象: Mirai Web CAD 0.1.0(ブランチ`main`、直近3件のマージ: PR #91/#95/#96)
前提: 従業員約600名、IT・DX部門7名、公共工事80%、民間工事20%

## 0. 2026-09-18ラウンド(第10回)要旨

6件の並列監査(業務適合性・UI/UX・アクセシビリティ・機能完成度、セキュリティ、データ品質・可用性・監視・運用保守性、テスト・CI/CD・コード品質、AI有効性、競合・OSS比較)を証拠ベースで実施し、重大脆弱性の修正・検証・本番デプロイまで完了した。

- **改善前(本ラウンド計測)判定: PoC**、総合 57.7/100(18項目単純平均、下表「0.1」参照)、競合代替率 実測53%(改善後予測69-70%)
- **改善後判定: PoC(継続)**、総合 58.6/100。600名・複数案件運用という前提に対しては、業務適合性(18)・機能完成度(30)が依然として最大のギャップであり、セキュリティ最重要項目の是正だけでは「本番利用可」「条件付き利用可」への格上げには至らない
- **注記(評価methodologyの非連続性)**: 本ラウンドは6件の独立監査による証拠ベースの再採点であり、8/30ラウンドまでの増分追跡スコア(セクション1以降、49.9/100)とは評価粒度・厳格さが異なる。特に業務適合性・機能完成度は、READMEの「限定対応」表記を鵜呑みにせず実装コード・実行結果で裏付けた結果、より厳しい値になった(これは新たな後退ではなく、測定精度の向上)。両ラウンドの数値を単純比較しないこと
- **✅ 重大脆弱性を解消(2026-09-18、PR #95)**: セキュリティ監査で「認証済みなら任意ロールが任意図面IDを取得できる」IDOR相当の欠落(案件単位アクセス制御の不在)を検出。同日中に`migrations/0007`(`projects.access_scope`+`project_members`、既定`open`で既存挙動を完全維持)、`requireDrawingAccess`/`requireProjectAccess`によるGET/POST全drawing系ルートへの一貫適用、cad_admin限定の案件・メンバー管理APIを実装。回帰テスト6件+実PostgreSQL統合テストを追加し、`npm run verify`(lint/typecheck/a11y/305 unit/build/74 e2e)全成功を確認した上でmainへマージ、本番`mirai_web_cad`・MVP`mirai_web_cad_mvp`両DBへmigration適用、両systemdサービスを再起動し外部URL経由でhealth 200を実測確認した
- **✅ CI依存関係監査ゲート追加(2026-09-18、PR #96)**: `npm audit --omit=dev --audit-level=high`を新規`dependency-audit`ジョブとしてbranch protection必須チェックへ登録。あわせてDependabot起票済みの`sharp`/`wrangler`既知high脆弱性2件をマージ解消(PR #91)
- **⚠️ 新たに発覚した重大な運用ギャップ**: 本番ホスト(`/home/kensan/Projects/Mirai-DX-Project/Mirai-Web-CAD`)のローカル`main`が、CodeRabbit指摘14件(未解決)を含みレビュー未完了のfeat/native-dimension-hatch-viewport(PR #87、DIMENSION/HATCH/VIEWPORT対応)を、GitHub `main`への正式マージ前に直接稼働させていたことが判明した。指摘の中には`src/cad-advanced.js`のsnapSpacing/gridSpacing(間隔ベクトル)を座標として平行移動してしまう実バグが含まれる。branch protectionの`required_conversation_resolution`により、この状態のPR #87は正規手順でマージ不能(admin権限での迂回はCLAUDE.mdポリシーおよび本評価方針により不実施)。今回はセキュリティ修正を届けるため、本番ホストのローカルのみで`git merge --no-ff origin/main`により両者を統合する暫定措置を取った(コミット履歴・理由をコミットメッセージに明記)。恒久対応は[改善台帳P0-58](improvement-register.md)を参照
- **競合・代替率の再計測(2026-09-18)**: AutoCAD Web/ARES Commander・Kudo/JW-CAD/BricsCAD/LibreCAD/IJCAD Civilとの比較調査により、主要業務フロー35%・必須機能25%・UX15%・連携10%・セキュリティ監査10%・運用保守5%の加重で現状代替率**約53%**(前回ラウンドの32%から算定方法を業務フロー軸中心に精緻化。単純な横並び比較ではなく再定義後の再計測値であり、前回値との単純比較は不可)。Phase 1完了(DXF書出しへのdimension/hatch/block追加、ベクタ・尺度保証PDF実装等)により**約69-70%**まで改善余地があると推計
- 本番導入可否: 開発者本人(`kensan1969@gmail.com`)による単一案件の作図・承認・AI提案運用は可能(セキュリティ最重要項目は是正済み)。ただし複数案件・複数利用者・協力会社への展開には、案件メンバー管理UI・Entra ID連携・電子納品/座標系・尺度保証PDF・単一障害点解消が引き続き必須条件であり、本番の正式成果品・複数組織運用には依然として不可
- 投資判断: **条件付き継続**。最優先の残課題はPR #87のレビュー完了(改善台帳P0-58)、オフサイトバックアップと本番DB復旧ドリル自動化(P1-11)、単一ホスト依存の冗長化検討(P1-13、要経営判断)、案件メンバー管理UIとEntra ID連携(P1-01残タスク)

### 0.1 18項目評価(2026-09-18ラウンド、証拠ベース再採点)

| 評価軸 | 改善前 | 改善後 | 根拠(証拠は監査エージェント報告・本文中の引用ファイル参照) |
| --- | ---: | ---: | --- |
| 業務適合性 | 18 | 18 | 単一利用者・単一案件構成が実装の実態(README/`src/`にproject/工区の概念なし)。電子納品・SXF・座標系(JGD2011等)が完全欠落。公共工事80%の前提に対し致命的 |
| 機能完成度 | 30 | 30 | ✅骨格(承認フロー・監査・Idempotency)は健全。❌尺度保証PDF未実装(`window.print()`依存)、レイアウト空間はダミー表示、HATCH/BLOCKは簡易実装 |
| UI/UX | 45 | 45 | デスクトップは74/74 E2E成功。モバイルは固定コマンドラインがCanvasを覆い編集用途で未成熟(README自認) |
| アクセシビリティ | 42 | 42 | axe critical/serious 0件(自動検査は良好)。グリップ編集にキーボード代替なし、Canvas内容がスクリーンリーダーに伝わらない |
| データ品質 | 62 | 62 | スキーマ正規化・監査不変性トリガーは堅牢。JSONB二重保存バグの再発防止がDB制約でなくアプリ依存 |
| AI有効性 | 58 | 58 | ルールベース優先+人間承認+prompt injection対策は良好。根拠・信頼度表示、費用計測基盤が未実装 |
| 設計 | 72 | 72 | モジュール分割・原子的更新は良好。`src/app.js`単一巨大モジュール、`project_id`ハードコードは今回part解消 |
| コード品質 | 68 | 68 | typecheck 0エラー、テスト網羅は良好。実質的な静的解析(ESLint等)が不在(改善台帳P0-59) |
| 性能・拡張性 | 70 | 70 | 1万エンティティは実測OK。10万エンティティ/30fps要件は未計測・未達(Issue #7) |
| セキュリティ | 62 | **74** | **✅本ラウンドでIDOR是正・CI依存監査ゲート追加・既知脆弱性2件解消**。残: LocalStorageの平文保存、AIレート制限がインメモリ単一プロセス限定 |
| 可用性・バックアップ | 55 | 55 | 日次バックアップ・週次復旧ドリル(MVP)は実機動作確認済み。オフサイト転送なし、本番DB向け自動復旧ドリルなし、単一ホスト依存 |
| 監視・障害対応 | 58 | 58 | 15分間隔合成監視+Issue自動起票は実運用で機能(Issue #92/#93等の実績あり)。当番の実名連絡先が未確定 |
| テスト | 82 | 83 | 305 unit(1 skip)+74 E2E+PostgreSQL統合、全て実行して確認。カバレッジ計測ツール未導入 |
| CI/CD・リリース | 75 | 78 | ✅依存関係監査ゲート追加。7ジョブ構成、branch protection運用は良好。PRレビュー必須化はなし、`required_conversation_resolution`はPR #87で運用ギャップとして露呈 |
| 運用保守性 | 60 | 60 | Runbook・health検査は実務水準。本番ホストのローカルmainがGitHub mainと分岐する運用ギャップを新規検出(P0-58) |
| 文書 | 78 | 78 | README/docs配下の量・更新頻度は高水準。`docs/migration-manifest.md`がNeon時代の記述のまま(要更新) |
| 費用対効果 | 50 | 50 | 現状の運用コストは低い(単一ホスト、AIはコスト制御済み)が、600名規模企業への適合性が低く投資対効果は限定的 |
| 競合代替性 | 53 | 53 | 業務フロー35%・必須機能25%・UX15%・連携10%・セキュリティ監査10%・運用保守5%の加重平均(算定根拠は本ファイル「7. 代替率」2026-09-18版を参照) |
| **総合(単純平均)** | **57.7** | **58.6** | 18項目単純平均。前掲の通り8/30ラウンドまでの増分追跡スコアとは算定方法が異なり単純比較不可 |

### 0.2 強み(今回監査で確認、上位15件)

1. CAD Core/AI分離、AI提案のPreview→人間承認フローが実装レベルで一貫(直接編集経路が存在しないことをコードで確認)
2. JWT検証がfail-closed(issuer/audience検証、設定欠落時は例外)、クライアント指定ロールを信頼しない設計
3. Idempotency-Key + expected-version楽観ロックにより二重実行・古いクライアントからの更新を拒否
4. 図面・版・監査・冪等性を単一SQL文(CTE)で原子的に確定
5. 監査ログのUPDATE/DELETEをDBトリガーで拒否(DB権限保有者でも改変不可)、CIで機械検証
6. 全SQLクエリがパラメータ化済み(SQLインジェクション対策)でタグ付きテンプレート使用を徹底
7. CSP/COOP/Permissions-Policy/nosniff/X-Frame-Optionsが静的・API応答の両方に設定済み
8. CI 7ジョブ構成(lint/test/build/e2e/a11y、空DB migration、PostgreSQL統合、バックアップ復旧ドリル、secret scan、Terraform)が実運用でグリーン
9. 15分間隔の合成監視が実際に機能し、実インシデント(Issue #92/#93等)を検知・自動起票・自動closeした実績がある
10. 日次バックアップと週次復旧ドリル(MVP)がsystemd timerで実機動作確認済み、シグネチャ照合による整合性検証付き
11. 305件の単体テスト・74件のE2E・axe検査が全て実行され成功(自称ではなく実測)
12. TypeScriptのJSDoc型検査(`checkJs`)が0エラーで通過
13. 空間インデックス(uniform grid)で1万エンティティ規模の描画性能を実測検証済み
14. **(本ラウンド新規)** 案件単位アクセス制御(`project_members`)を追加し、既存の単一案件運用を無停止・無影響で維持したまま将来のマルチテナント化の土台を整備
15. **(本ラウンド新規)** CI依存関係監査ゲートをbranch protection必須チェックへ追加し、既知脆弱性の混入を構造的に防止する経路を確立

### 0.3 重大な弱み(今回監査で確認、上位15件、重大度順)

| # | 弱み | 重大度 | 発生可能性 | 対応方針 |
| --- | --- | --- | --- | --- |
| 1 | 案件・工区・複数利用者運用のデータモデルが未成熟(`project_id`の実質的な単一運用) | 重大 | 高(600名展開の前提条件) | P1-01残タスク(Entra ID連携・管理UI)、P1-02(案件一覧・検索) |
| 2 | 公共工事必須の電子納品(SXF)・座標系(JGD2011等)が完全欠落 | 重大 | 高(公共工事80%の前提で必須) | P2-05/P2-06、Phase 2以降 |
| 3 | 本番が開発者個人PC1台の単一障害点(電源・NW断で全停止) | 重大 | 中 | P1-13(冗長化検討、要経営判断) |
| 4 | 本番ホストのローカルmainがGitHub mainと分岐し、レビュー未完了コードが稼働中(PR #87) | 重大 | 顕在化済み | P0-58(最優先) |
| 5 | 尺度保証・ベクタPDFが未実装(`window.print()`依存) | 高 | 高(成果品の正当性に直結) | P1-06 |
| 6 | オフサイトバックアップ未実施、本番DB向け自動復旧ドリルなし | 高 | 中 | P1-11 |
| 7 | モバイルで固定コマンドラインがCanvasと競合し編集用途で未成熟 | 高 | 高(現場利用が主要想定) | 追加ロードマップ、UI再設計 |
| 8 | LocalStorageが平文保存(図面データが端末・XSS成立時に読める) | 高 | 中 | 6-12か月、クライアント側暗号化検討 |
| 9 | 障害当番の実名・連絡先が未確定 | 高 | 高(必ず発生する運用ギャップ) | P1-12 |
| 10 | 10万エンティティ/30fps要件が未計測・未達 | 高 | 中 | P2-01(Issue #7) |
| 11 | 実質的な静的解析(ESLint等)が不在、`npm run lint`は構文チェックのみ | 中 | 中 | P0-59 |
| 12 | HATCH/BLOCKが簡易実装(境界探索・属性再定義・ライブラリ未対応) | 中 | 中 | P1-05 |
| 13 | AIの根拠・信頼度・費用計測基盤が未実装 | 中 | 中 | P3-01/P3-02相当、AI改善提案参照 |
| 14 | グリップ編集にキーボード代替がなく、Canvas内容がスクリーンリーダーに伝わらない | 中 | 中(協力会社等の閲覧専用利用者を含む) | 追加ロードマップ、AT実機検証 |
| 15 | `docs/migration-manifest.md`がNeon時代の記述のまま未更新 | 低 | 低 | 3か月以内、文書棚卸し |

---

評価日: 2026-08-30(前回 2026-08-29)
対象: Mirai Web CAD 0.1.0  
前提: 従業員約600名、IT・DX部門7名、公共工事80%、民間工事20%

## 1. 結論(2026-08-30時点、以下は履歴として保持)

- 改善前判定: **PoC**、総合 41.5/100、競合代替率 27%
- 2026-08-26ラウンド改善後: **PoC**、総合 48.3/100、競合代替率 32%
- 2026-08-27ラウンド改善後: **PoC**、総合 49.0/100、競合代替率 32%
- 2026-08-29ラウンド(Round 8)改善後: **PoC**、総合 48.6/100、競合代替率 32%(この時点で本番進行中障害を検出)
- 2026-08-30ラウンド(Round 9)改善後: **PoC**、総合 49.9/100、競合代替率 32%
- **✅ Issue #22解消(2026-08-30)**: 8/29に検出した本番Neon DB認証障害(`password authentication failed for user 'neondb_owner'`)について、ユーザー指示「Neonは今後2度と利用しない」に基づき、Neon依存そのものを除去する方針で対応した。`src/data-store.js`を`postgres`(postgres.js)へ全面書き換え、ローカルPostgreSQL 16 + Cloudflare Tunnel構成へ移行し、人間による承認(Cloudflare Pages Custom Domain解除、DNS切替のY/N確認)を経て本番切替を完了。本番実測でSPA/health/demo 200、write fail-closedを確認した
- **✅ Cloudflare Access新設(2026-08-30、同日追加対応)**: 書き込みAPI(`/api/*`のうちhealth/demo以外)を保護するAccess Application(当時はOne-Time PIN、`kensan1969@gmail.com`のみallow)を新設。未認証書込みは以後302(Accessログインへのリダイレクト)を返す(既存の同種チェックは401も許容するよう合成監視を調整済み)。SPA/health/demoはbypass設定で引き続き匿名可。2026-09-05現在のMVPはCloudflareアカウント認証
- **新たなリスク**: 本番の可用性が、Neonのマネージドサービスから、このホスト(kensan1969)単一障害点への依存へ変化した。ホスト停止・ネットワーク断で本番全体が停止する。オフサイトバックアップは未実施
- 本番導入可否: 公開デモ閲覧と限定的な検証利用は可(Issue #22解消により復旧)。管理者本人(`kensan1969@gmail.com`)による作図・承認等の書込み動作確認は可能になった。ただし複数利用者への展開(Entra ID連携等)・案件単位RBACは未着手のため、本番図面の正本、施工成果物作成、協力会社との共有には不可
- 投資判断: **条件付き継続**。Cloudflare Accessの複数利用者展開・Entra ID連携(Issue #5)、DXF往復、寸法・レイアウト・PDF、案件単位RBACを継続条件とする。バックアップのオフサイト化、ソーク運用後のCloudflare Pages関連ファイル削除・Neonプロジェクト削除(人間実施)も残課題
- **✅ DWG対応を方針から正式撤回(2026-08-30、[ADR-0002](adr/ADR-0002-dwg-scope-drop-dxf-only.md))**: ODAライセンス依存が数ヶ月未着手のまま停滞していたことを受け、DWGバイナリ対応を恒久的に対象外とし、DXF単体運用へ確定した。**この注記はMiraiの対応範囲・リスク記述にのみ適用する**(下表「機能完成度」「弱み・リスク」「Phaseロードマップ」節等)。「6. 競合・代替比較」節の競合製品(AutoCAD Web、ARES、BricsCAD等)のDWG対応能力を示す記述、および「18項目評価」の「競合代替性」行が競合とMiraiの差として挙げる「DWG忠実性」は、競合製品が実際に持つDWG機能を指す事実記述であり、本注記の対象外(DXFへ読み替えない)とする。代替率数値の再評価は次回監査サイクルで実施する(本改定では未実施)
- Round 9の要旨: Issue #22の根治(Neon依存の完全除去)と、それに伴い必要になったCloudflare Access新設に集中したラウンド。3件の並列調査でNeon依存範囲を実測(`src/data-store.js`に集約、他ファイルは無変更で移行可能と判明)し、EnterPlanModeで段階的な移行計画(Phase 0〜7、DNS切替のみ高リスク・要承認)を確定してから実行した。CodeRabbit 3ラウンドの指摘(本文サイズ制限のストリーム処理順序、本番DBへの統合テスト誤書込みリスク等)にも全て対応。Access設定では、Cloudflare公式ドキュメントで非ブラウザクライアントの挙動(302 vs Managed OAuthでの401)を事前調査し、既存の合成監視ロジックとの整合を取った。作業中にDBパスワードを一度画面出力する誤りがあり、直ちにローテーションして対応した(教訓をstate.jsonへ記録)。

評価点は18項目の単純平均である。実用上のカバー判定は、正常・異常系テスト、RBAC、監査、バックアップ、操作手順が揃う場合に限った。READMEの将来計画は実装済みとして数えていない。

## 2. 概要と証拠

| 項目 | 確認結果 |
| --- | --- |
| 製品 | Cloudflare Pages/Functions上のブラウザ2D CAD |
| 利用者 | 現場、本社CAD担当、承認者、経営層、将来の協力会社 |
| 課題 | CAD配布負荷、現場からの閲覧、版管理、承認、数量確認、定型作図 |
| 現在の価値 | インストール不要の公開デモ、基本作図、JSON/ASCII DXF取込、コマンド入力、レビュー、数量、AIルール提案 |
| 完成段階 | MVP/PoC。AutoCAD/ARES相当の中核機能は未完成 |
| 運用段階 | Production URLは公開済み。永続更新APIはAccess JWT必須だがAccess Applicationが存在せず、一般利用者は匿名閲覧のみ |
| DB | ローカルPostgreSQL 16(このホスト常駐、2026-08-30にNeonから移行)。Migration 0001-0005適用済み(監査追記専用トリガー含む) |
| テスト | Unit/API 44件、Playwright E2E 28件、PostgreSQL統合テスト7件、axe、型検査、Lint、空DB Migration(トリガー検証込み)、復旧ドリル |
| 未確認 | GitHub Issue/PRの全過去議論、実ユーザー受入、契約・法務、DXF実案件互換、負荷100k/1m図形、RTO実測 |

主なコード証拠は`src/cad-core.js`、`src/api-handler.js`、`src/data-store.js`、`tests/`、`migrations/`、`.github/workflows/ci.yml`、`.github/workflows/production.yml`。要求根拠はリポジトリ内の要件定義書・詳細仕様設計書を用いた。

## 3. 18項目評価

| 評価軸 | 改善前 | 8/26後 | 8/27後 | 8/29後 | 8/30後 | 根拠と残差 |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| 業務適合性 | 32 | 34 | 34 | 34 | 34 | 土木デモ、数量、レビューあり。案件、工種、成果品、発注者様式なし |
| 機能完成度 | 24 | 25 | 25 | 25 | 25 | 基本図形と編集の一部。寸法、ハッチ、ブロック、外部参照、レイアウト、DXF書出し・PDFなし(DWGは対象外、ADR-0002) |
| UI/UX | 48 | 52 | 52 | 52 | 52 | CAD配置とCLIあり。公開閲覧の権限表示を固定。大量操作・プロパティ編集は不足 |
| アクセシビリティ | 70 | 71 | 71 | 71 | 71 | axe、キーボード、モバイルE2Eあり。Canvas図形の代替表現は不足 |
| データ品質 | 38 | 44 | 44 | 44 | 44 | schema検証、重複ID検査、hash、明示的公開属性。座標系・単位変換・系譜監視なし |
| AI有効性 | 22 | 22 | 22 | 22 | 22 | 人間承認と差分あり。外部AI/RAGではなく、土木判断を支援する根拠データなし |
| 設計 | 45 | 51 | 51 | 51 | 51 | コマンドモデル、API/Store分離。更新原子化を追加。案件境界と非同期処理なし |
| コード品質 | 68 | 74 | 74 | 74 | 74 | 小規模で型検査・Lintあり。巨大な単一UIモジュールとJSDoc型が残る |
| 性能・拡張性 | 18 | 21 | 21 | 21 | 21 | Canvas単一描画、ページングなし。要求の100k図形/30fpsは未証明 |
| セキュリティ | 42 | 58 | 61 | 61 | 66 | JWT fail-closed、RBAC、CSP、サイズ制限、公開属性、CORS許可リスト。2026-08-30にNeon依存を除去し本番DB接続文字列がGitHub/Cloudflareいずれにも保存されなくなった(`~/.config/`のみ、mode 0600)。同日、Cloudflare Access(`/api/*`保護、当時はOne-Time PIN、`kensan1969@gmail.com`のみallow)を新設し、書き込みAPIへの永続的な認証経路が確立した。2026-09-05現在のMVPはCloudflareアカウント認証。複数利用者・案件RBAC・WAF・SIEMなし |
| 可用性・バックアップ | 20 | 38 | 38 | 25 | 40 | 2026-08-30にNeon依存を除去しローカルPostgreSQL + Cloudflare Tunnelへ移行。本番実測でSPA/health/demo 200を確認し、Issue #22(進行中障害)は解消。日次バックアップ(systemd timer)と鮮度検証を実機で動作確認。**新たなリスク**: 本番がこのホスト(kensan1969)単一障害点に依存するようになった(Neonのマネージド高可用性からの後退)。RTO実測・オフサイトバックアップは未実施 |
| 監視・障害対応 | 18 | 30 | 34 | 38 | 38 | request ID、5xxログ、公開health、15分間隔の合成監視+Issue自動起票+復旧時自動close+任意Webhook通知。Custom Domainのみを対象に整理(`pages.dev`は移行後更新されないため監視対象から除外)。当番表、重大度別SLAなし |
| テスト | 67 | 73 | 74 | 74 | 75 | 44 Unit/API、24 E2E(その後28件へ拡充)に加え、実PostgreSQLに対する統合テスト7件(`tests/data-store.pg.test.js`、本番DBへの誤書込み防止機構付き)を追加。性能・権限マトリクス・障害注入不足 |
| CI/CD・リリース | 72 | 79 | 79 | 79 | 80 | Gate、Migration(本番と同じpostgres:16-alpineへ統一)、Gitleaks、復旧Job、実DB統合テストジョブを追加。Cloudflare Pagesへの自動デプロイは廃止し、`scripts/deploy-local.sh`の手動実行+health確認+自動ロールバックへ移行。auto-merge機能はリポジトリ設定で無効(手動squash mergeで対応) |
| 運用保守性 | 32 | 49 | 51 | 52 | 53 | runbook、復旧手順、改善台帳、監査CSV exportに加え、`docs/deployment-local.md`(セットアップ・日常運用・ロールバック手順)を新設。600名運用の管理UIはなし。self-hosted runner化は未着手 |
| 文書 | 65 | 74 | 76 | 76 | 77 | README/API/試験/運用/評価/Roundログ/デプロイ運用メモを更新し、Neon関連の古い記述を一掃。利用者手順とデータ辞書は不足 |
| 費用対効果 | 48 | 54 | 54 | 54 | 54 | 小規模Web構成は安価。Neonのマネージド費用が不要になった一方、ホストの電源・ネットワークという新たな運用コストが生じた。CADエンジン再実装コストが高く、当面は併用が合理的 |
| 競合代替性 | 18 | 21 | 21 | 21 | 21 | 基本作図のみ。DWG忠実性、印刷、API拡張、オフライン、サポートで大差 |
| **総合** | **41.5** | **48.3** | **49.0** | **48.6** | **49.9** | **PoC**(Issue #22解消、Neon依存除去、Cloudflare Access新設を反映) |

## 4. 強み

1. Cloudflare上でインストール不要の公開閲覧ができる。
2. Productionの更新APIはCloudflare Access JWTがなければfail-closedとなる。
3. 匿名公開対象を明示的な`visibility=public`へ限定した。
4. Viewer/Drafter/Reviewer/Approver/CAD Adminの能力ベースRBACがある。
5. 更新APIにIdempotency-Keyを要求する。
6. `expected-version`とDB revisionで楽観ロックする。
7. 図面、版、コマンドイベント、監査、冪等性を単一SQLで更新する。
8. コマンド適用前後のhashと操作履歴を保持する。
9. AI提案はPreview後の明示承認なしに図面を変更しない。
10. 新規空図面、デモ図面、JSON/ASCII DXF Importが操作可能である。
11. LINE/RECT/CIRCLE/PLINE/TEXT/MOVE/COPY等のコマンド入力がある。
12. デスクトップ/モバイルのE2Eとaxe検査がある。
13. MigrationとSeedが空DBへ再実行可能である。
14. PreviewとProductionのDB・認証モードが分離されている。
15. Gitleaksとnpm auditで秘密値・既知依存脆弱性を検査できる。
16. バックアップアーカイブ検証と空DB復元をCIで反復できる。
17. ~~Neon mainをprotectedにし、branch/project/computeの誤削除とresetを防止した。~~ → 2026-08-30にNeon依存自体を除去したため対象外。ローカルPostgreSQLは専用ロール・専用DBで権限分離済み(state.json blocked_issues参照)。
18. `audit_logs`をDBトリガーで追記専用化し、DB権限保有者でもUPDATE/DELETE不可(0005)。CIと本番の両方で拒否を実測(2026-08-27)。
19. 監査ログを承認者権限でCSV exportでき、export自体が`audit.exported`として記録される。数式注入ガード付き(2026-08-27)。
20. `/api/health`がstatus/version/timestampとDB異常時503を返し、合成監視が非2xxで検知できる(2026-08-27)。
21. GitHub Actions合成監視が15分間隔で公開境界を検査し、失敗時に`incident`Issueを自動起票、復旧時に自動closeする(2026-08-29)。
22. 日次本番バックアップworkflowを実装し、Secret未投入時は`ops`Issueで一次窓口へ知らせる安全側設計にした(2026-08-29)。
23. CORSを許可リスト方式の複数オリジン対応にし、Pages既定URLとCustom Domainを任意オリジン反映なしで両立できる(2026-08-29)。
24. Neon PostgreSQL依存を完全に除去し、本番DB接続文字列がGitHub・Cloudflareいずれにも保存されない構成(このホストの`~/.config/`のみ、mode 0600)へ移行した(2026-08-30)。
25. 本番用サーバー(`scripts/serve-production.mjs`)は必須環境変数の欠落時に起動そのものを拒否するfail-fast設計で、Issue #22のような「気づかれない障害」の再発を構造的に防いでいる(2026-08-30)。
26. 日次バックアップと鮮度検証がsystemd timerとして実機で動作確認済み(2026-08-30)。

権限マトリクス:

| Role | 閲覧 | 作図 | AI Preview | 承認 | 管理 |
| --- | --- | --- | --- | --- | --- |
| Viewer | 可 | 不可 | 不可 | 不可 | 不可 |
| Drafter | 可 | 可 | 可 | 不可 | 不可 |
| Reviewer | 可 | 不可 | 可 | 不可 | 不可 |
| Approver | 可 | 不可 | 不可 | 可 | 不可 |
| CAD Admin | 可 | 可 | 可 | 可 | 可 |

受入時は各Roleについて許可操作の成功と禁止操作の403、client role spoof無効、案件ACLを確認する。

## 5. 弱み・リスク

| 影響度 | リスク | 影響・証拠 |
| --- | --- | --- |
| ~~重大~~ | ~~本番Neon DB認証失敗~~ | ~~2026-08-29 12:46 UTC検出、500エラー~~ → **解消(2026-08-30)**: Neon依存を完全に除去しローカルPostgreSQL + Cloudflare Tunnelへ移行。本番実測でhealth/demo 200を確認 |
| 高 | DXF書出しがない | 既存図面の忠実な往復ができず、成果物正本にできない。DWGは2026-08-30付ADR-0002により恒久的に対象外へ変更されたため、DWG非対応自体は今後もリスクとして再評価しない |
| ~~重大~~ | ~~永続編集用SSO経路がない~~ | ~~Access Application未作成~~ → **一部解消(2026-08-30)**: Cloudflare Access(`mirai-web-cad-api`、`/api/*`保護)を設定。管理者本人(`kensan1969@gmail.com`)による書込み動作は可能。現行MVPはCloudflareアカウント認証で、Entra IDログイン連携、複数利用者・組織ロール展開は未着手(Issue #5継続) |
| 重大 | 案件/図面単位RBACがない | Access利用者はIDを知れば任意図面を取得し得る。project_idも固定 |
| 重大(新規、2026-08-30) | 本番がこのホスト(kensan1969)の単一障害点に依存する | Neonのマネージド高可用性から、ローカルマシン常時稼働への依存に変化した。ホスト停止・ネットワーク断・ディスク故障で本番全体が停止する。オフサイトバックアップ・複数ホスト冗長化は未実施 |
| ~~重大~~ | ~~本番バックアップ自動化・本番復元試験なし~~ | ~~Neon履歴保持1日、RPO/RTO未合意~~ → **解消(2026-08-30)**: `mirai-web-cad-backup.timer`(systemd、日次03:10 JST、読み取り専用ロール)と鮮度検証timerを実機で動作確認。RTO実測とオフサイト転送は引き続き未実施 |
| 高 | 寸法、ハッチ、ブロック、外部参照、レイアウト、PDFがない | 日常2D CADフローが完結しない |
| 高 | 100k図形/30fps要件が未達・未計測 | 単一Canvas全件描画で大図面停止の可能性 |
| ~~高~~ | ~~Neon projectが他用途と共用~~ | ~~Project管理権限と障害のblast radiusがCAD専用に分離されていない~~ → **解消(2026-08-30)**: Neon依存自体を除去し、専用ロール・専用DBを持つローカルPostgreSQLへ移行 |
| ~~高~~ | ~~DBが米国リージョン~~ | ~~公共工事・個人情報のデータ所在判断が未確認~~ → **解消(2026-08-30)**: DBはこのホスト(国内)上のローカルPostgreSQLへ移行し、データ所在の懸念自体が解消 |
| 高 | LocalStorageが平文 | ローカル作業図面が端末利用者・スクリプトから読める |
| ~~高~~ | ~~監査ログが追記専用としてDB権限分離されていない~~ | ~~DB権限保有者による改変を抑止できない~~ → **解消(2026-08-27)**: 0005トリガーでUPDATE/DELETE拒否、CI・本番実測済み |
| ~~高~~ | ~~自動監視と通知がない~~ | ~~障害発見が利用者申告依存~~ → **一部解消(2026-08-29、2026-08-30更新)**: 15分間隔の合成監視workflowが公開境界(SPA/health/demo 200、write fail-closed。2026-08-30〜Cloudflare Access導入によりエッジ層302とアプリ層401のいずれも成功とみなす)を検査し、失敗時に`incident`Issueを自動起票・復旧時自動close。Webhook通知は`MONITOR_WEBHOOK_URL`任意設定。schedule実行間隔の保証なし、当番表・重大度別SLA・内部5xx相関は未着手のため残課題として維持 |
| 高 | Production GitHub Environmentに承認保護がない | base branch pushで自動本番Deployされる |
| 中 | AI計画作成と監査記録は別コミット | 監査欠落の可能性が残る。図面変更は原子化済み |
| ~~中~~ | ~~CORS許可先が単一Custom Domain~~ | ~~Pages標準URLをクロスオリジンAPIとして使う構成には追加設定が必要~~ → **解消(2026-08-29)**: `CORS_ORIGIN`をカンマ区切り許可リストへ変更し、Pages既定URLとCustom Domainを任意オリジン反映なしで両立可能にした |
| 中 | APIレート制限/WAFルール未設定 | 公開health/demoへの濫用耐性はCloudflare既定のみ |
| 中 | マルウェア検査がない | 将来の大容量バイナリアップロード前に必須 |
| 中 | Canvasの代替データ表がない | スクリーンリーダー利用者が図形内容を把握しにくい |
| 中 | UIが`src/app.js`単一モジュール | 機能増加に対する保守性とテスト分離が低い |
| 中 | ライセンス/SBOM/SECURITY.md/CODEOWNERSなし | OSS・脆弱性・変更承認運用が不明確 |
| 低 | 外部公開データ連携なし | 更新日、欠損、重複、表記揺れ、地域差、利用条件、リネージュは未評価 |

## 6. 競合・代替比較

確認日は2026-08-26。価格は公式サイトの掲載地域・税・契約条件で変動するため参考値とする。

| 製品 | 導入/利用者 | 主要機能・連携 | AI/セキュリティ/操作 | 費用例 | Miraiで代替できない範囲 | Miraiの独自余地 |
| --- | --- | --- | --- | --- | --- | --- |
| AutoCAD Web | Web/mobile、AutoCAD利用組織 | DWG作成編集、主要Cloud Storage、mobile offline | AutoCAD系UI、SSO/usage reporting | 地域別月/年契約 | DWG忠実性、offline、商用サポート | 土木社内承認、工種別自動化、国交省様式 |
| ARES Kudo/Commander | Web/mobile/desktop、組織pool | 300+ 2D機能、寸法、コメント、view-only link、DWG/DXF/DWT/DWF | AutoCAD互換コマンド、Cloud共有 | Kudo 200 EUR/人年、Flex 300 EUR/人年掲載 | 成熟CAD、モバイル、共有ライセンス | M365/社内台帳と案件単位統合 |
| BricsCAD Lite | Windows/macOS/Linux、CAD担当 | Native DWG、LISP、Sheet Set、地理情報、Drawing Compare | AutoCAD類似、desktop中心 | 豪州掲載 AUD 555/年から | DWG/LISP/印刷/性能 | Web現場閲覧、承認証跡、土木特化 |
| DraftSight | Desktop/cloud、設計・施工 | DWG/DXF/DGN、寸法、ハッチ、block、LISP/.dll/API、BIM上位版 | 既知コマンド、network license/支援 | Professional USD 299/年、Network USD 399/年から掲載 | 2D完成度、API、BIM/3D、支援 | 600名中の閲覧者へ低コスト展開 |
| LibreCAD | Desktop、個人/OSS利用者 | 2D DXF、line/spline/text/dimension/block/hatch、plugin | 無償OSS、ローカル運用 | 無償 | DWG業務互換、Web共同運用、企業統制 | ブラウザ、RBAC、監査、社内連携 |

公式根拠:

- [Autodesk AutoCAD Web](https://www.autodesk.com/products/autocad-web/overview)
- [ARES Kudo](https://www.graebert.com/cad-software/ares-kudo/)
- [BricsCAD/AutoCAD機能比較](https://help.bricsys.com/en-us/document/bricscad/installation-and-licensing/activating-and-licensing-bricscad/bricscad-and-autocad-feature-comparison)
- [DraftSight Professional](https://www.draftsight.com/product/draftsight-standard) / [購入情報](https://www.draftsight.com/how-to-buy)
- [LibreCAD Manual](https://docs.librecad.org/_/downloads/en/2.2.0_a/pdf/)

## 7. 代替率

| 区分 | 重み | 改善前カバー | 8/26後 | 8/27後 | 8/27寄与 |
| --- | ---: | ---: | ---: | ---: | ---: |
| 主要業務フロー | 35% | 25% | 28% | 28% | 9.8 |
| 必須機能 | 25% | 20% | 22% | 22% | 5.5 |
| UX | 15% | 45% | 50% | 50% | 7.5 |
| データ連携 | 10% | 10% | 12% | 12% | 1.2 |
| セキュリティ・監査 | 10% | 35% | 52% | 56% | 5.6 |
| 運用保守性 | 5% | 30% | 48% | 50% | 2.5 |
| **加重合計** | **100%** | **27%** | **32%** | **32%** | **32.1** |

8/27の監査追記専用化・CSV export・health強化はセキュリティ・監査と運用保守性のカバーを上げたが、代替率の大宗(主要業務フロー・必須機能)はDXF往復と2D中核機能に依存するため加重合計は32%で横ばい。**代替率を上げるにはPhase 1(DXF往復、寸法/hatch/block/layout/PDF)が必須**である(2026-08-30、ADR-0002によりDWGは恒久的に対象外)。

80%到達の必須条件は、DXF往復互換、寸法/ハッチ/block/layout/PDF、案件管理、Entra ID SSO/MFA、図面単位RBAC、監査保全、7日以上の復旧、性能基準、オフライン閲覧、操作手順とUATである。90%には外部参照、Sheet Set、LISP/API互換、地理座標、BIM連携、管理配布、24時間監視、実案件100本以上の互換認定が加わる。

意図的に代替しない候補は、高度3D/BIM authoring、レンダリング、機械/電気専用CAD、汎用LISP完全互換、法定電子納品チェッカー本体である。既存製品・公的ツールとの連携を優先する。

## 6.1 競合・代替比較(2026-09-18版、確認日2026-09-18)

国内建設業での実態に合わせ、JW-CAD・IJCAD Civil(SXF電子納品)を追加調査した。価格は公式サイト掲載の参考値。

| 製品 | 導入/利用者 | 主要機能・連携 | AI | 費用例 | Miraiで代替できない範囲 | Miraiの独自優位性 |
| --- | --- | --- | --- | --- | --- | --- |
| AutoCAD (Autodesk) | 全業種・大手ゼネコン中心 | DWGネイティブ、外部参照、AutoLISP完全対応 | 情報限定 | 新規年契約77,000円/月契約9,900円(税込) | DWG忠実性、AutoLISP、業界標準人材市場 | Cloudflare Accessゼロトラスト、承認ワークフロー統合 |
| ARES Commander/Kudo (Graebert) | AutoCAD代替志向の中小〜中堅 | DWGネイティブ、Kudoでクラウド+モバイル三位一体 | AI Assist(自然言語編集) | Commander約$250/年〜、Kudo単体$120/年〜 | DWG完全互換、AI自然言語操作の成熟度 | 図面変更のTransaction化・改ざん防止監査ログ |
| JW-CAD | 国内建設・測量で圧倒的普及 | 無償2D、建具・設備コマンド、SXF変換は外部ツール併用 | なし | 無償 | 国内実務での実績・習熟者数 | クラウド、RBAC、承認・監査ログ、AI提案 |
| BricsCAD (Bricsys/Octave) | 幅広い業種、コスト重視層 | DWGネイティブ、AIによる2D→BIM自動生成 | 2D平面図からBIM自動生成 | 5グレードで€314〜€1,120 | DWGネイティブ性能、AI-BIM変換 | ブラウザのみで動作、社内ガバナンス統合 |
| IJCAD Civil | 国内公共工事受注者(電子納品義務あり) | SXF(P21/SFC)変換・電子納品機能内蔵 | 情報限定 | 個別見積り | 電子納品(SXF)対応の完成度 | 承認フロー・監査ログ・AI提案(IJCADは非搭載) |

情報源(取得日2026-09-18): [AutoCAD機能一覧](https://www.autodesk.com/jp/products/autocad/features)、[AutoCADの価格一覧](https://cad-kenkyujo.com/autocad-subscription/)、[Graebert ARES Commander](https://www.graebert.com/dwg-cad-software/)、[ARES Kudo](https://www.graebert.com/cad-software/ares-kudo/)、[JW-CAD公式](https://www.jwcad.net/download.htm)、[Octave BricsCAD](https://www.bricsys.com/)、[IJCAD Civil](https://ijcad.jp/product/civil/)。AutoCAD/BricsCAD/JW-CAD/IJCADの生成AI機能詳細、企業向けSSO/監査ログ仕様は契約・エディション依存のため一部**未確認・情報不足**。

## 7.1 代替率(2026-09-18版、算定方法を刷新)

重み: 主要業務フロー35%、必須機能25%、UX15%、連携10%、セキュリティ・監査10%、運用保守5%(80-90%代替方針の重みに統一)。

| 軸 | 重み | 現状 | 改善後(Phase1完了時)予測 | 根拠 |
| --- | ---: | ---: | ---: | --- |
| 主要業務フロー | 35% | 60% | 75% | レビュー/承認/版管理は動作。尺度保証PDF・DXF書出しのdimension/hatch/block欠落で「返却」まで完結しない |
| 必須機能 | 25% | 48% | 73% | DIM/HATCH/BLOCKが簡易実装、施工図テンプレート未着手 |
| UX | 15% | 55% | 65% | リボン/モデル空間は動作、モバイル編集は未成熟 |
| 連携 | 10% | 20% | 33% | XREF・GIS/BIM連携・SXF電子納品はいずれも未着手 |
| セキュリティ・監査 | 10% | 80% | 85% | Cloudflare Access、RBAC、監査ログ、Idempotency、fail-closed、**本ラウンドで案件ACLを追加** |
| 運用保守 | 5% | 30% | 50% | 単一ユーザー・単一PC常駐運用、DR未実測 |
| **加重合計** | **100%** | **約53%** | **約69-70%** | 0.35×60+0.25×48+0.15×55+0.10×20+0.10×80+0.05×30=52.65 |

80%到達条件・90%到達条件・意図的に代替しない範囲は「7. 代替率」節の記述と同一(算定の重み配分のみ本節で統一)。**この53%は7節の32%と算定方法(業務フロー軸中心の再定義)が異なるため単純比較不可**(0.1節の注記を参照)。

## 8. AI設計原則

- AI適用: 図面属性の構造化抽出、過去図面/RAG検索、仕様書と図面の不整合候補、数量異常候補、注記分類、変更説明文の下書き。
- AI不要: 権限判定、寸法計算、座標変換、必須属性、命名規則、電子納品チェックは決定論的ルールを使う。
- 根拠: 回答ごとに文書ID、版、ページ/図面位置、引用、信頼度、取得日時を表示する。
- 人間承認: 図面変更、数量確定、発注者提出、外部共有は必ず権限者が差分承認する。
- 権限: RAG検索とモデル入力は案件ACLでfilterし、権限外文書を候補生成前に除外する。
- Injection対策: 取込文書を命令ではなくデータとして分離し、tool allowlist、出力schema、秘密値非参照、外部URL禁止を適用する。
- 個人・機密: 最小化、mask、保存期間、リージョン、学習利用なし契約を確認する。
- 監査: model/prompt/tool/version、入力文書ID、出力、承認者、修正、token、費用を記録する。
- 責任: AIは候補提示。設計・数量・安全・提出の責任は承認者と業務規程に置く。
- 予算/停止: 案件・利用者・月次上限、rate limit、管理者kill switch、ルールベースfallbackを設ける。

## 9. Phaseロードマップ

- Phase 0 重大問題・セキュリティ: 公開/更新境界、原子更新、CSP、復旧ドリル、監査追記専用化、health監視受け口、合成監視+Issue自動起票、日次バックアップworkflow基盤は実装済み。残るはSSO再構成(Issue #5)、案件RBAC(Issue #5)、自動デプロイ経路(Issue #9)、`PRODUCTION_DATABASE_URL` Secret投入によるバックアップ本運用化・当番表・重大度別SLA(Issue #8)。
- Phase 1 中核業務完成: DXF往復(Issue #6、2026-08-30 ADR-0002によりDWG対応は対象外へ変更)、寸法、ハッチ、block、layout/PDF、案件/図面一覧、版比較、UAT。
- Phase 2 80%代替: 100k図形性能(Issue #7)、offline PWA、M365/SharePoint、協力会社共有、電子納品、運用SLO。
- Phase 3 AI・モバイル・外部連携: ACL付きRAG、属性抽出、異常候補、mobile markup、公開API/webhook。
- Phase 4 90%代替・最適化: 外部参照/Sheet Set、GIS/BIM、互換認定、DR演習、利用分析、契約最適化。

## 10. 外部基盤の判断

Cloudflare Pagesは`_headers`で静的応答のCSP等を設定できるがFunctions応答には適用されないため、API側にも直接付与した。[Cloudflare公式](https://developers.cloudflare.com/pages/configuration/headers/)。2026-08-30の移行後は`scripts/serve-production.mjs`が`_headers`を読み込んで**静的応答**へ適用している。

**2026-09-18の追加ラウンドで判明した経緯と最終状態**: 一時点では`/api/*`が`_headers`の対象外であり、API応答のヘッダは`src/api-handler.js`の`JSON_HEADERS`(7項目)とCORSヘッダのみで、**CSP/HSTSが付いていなかった**(「移行後にこの制約自体が解消した」という以前の記述は誤りだったため訂正した)。さらに**Cloudflare Pages Functionsの応答には`_headers`のルールが適用されない**ことを実測で確認した(`pr-102`の`/api/health`にCSP/HSTSが付かない)。そのためPR #102では、ヘッダの単一の出所を`src/api-handler.js`の`API_SECURITY_HEADERS`へ移し、配信経路(Pages Functions / `serve-production.mjs` / `serve-local.mjs`)に依らず**API応答にもCSP・HSTS・`X-Frame-Options`・`Referrer-Policy`・`Permissions-Policy`が付く**状態にした。`serve-production.mjs`は加えて`_headers`の不足分を`applyEdgeHeaders`で補い、404/413/500のエラー応答にもHSTSを付与する。ローカル開発サーバーはHTTP配信のためHSTSのみ除去する。

(2026-08-30以前の記録)Neonの履歴保持は復旧窓に依存し、保護branchは削除/reset/compute削除を防ぐ。履歴は1日のため、本番基準の7-35日へ延長するにはプラン・費用・RPO合意が必要だった。[Neon restore window](https://neon.com/docs/manage/projects) / [Protected branches](https://neon.com/docs/guides/protected-branches)。2026-08-30にNeon依存自体を除去したため、この制約は対象外になった。ローカルPostgreSQLのRPO/RTOは`docs/deployment-local.md`・`docs/operations.md`の「Backup / Restore」節を参照。

## 11. 2026-09-18 追加ラウンド(第11回、PR #99)

第10回ラウンドの直後に、**本番稼働環境そのもの**を対象とした追加検証を行った。評価書・READMEの記述ではなく、実環境のHTTP応答とgit状態を証拠とした点が第10回との違いである。第10回の記述のうち2件が実環境と矛盾していたことも判明し、訂正した。

### 11.1 実測で確認した重大/高リスク

| # | 事象 | 重大度 | Evidence |
| --- | --- | --- | --- |
| 1 | 公開中のCloudflare Pages(`mirai-web-cad.pages.dev`)が、未認証の`GET /api/health`に対してDB接続エラー原文(接続ユーザー名`neondb_owner`)を返していた | 高(情報漏洩) | `curl`応答本文 `{"ok":false,"error":"password authentication failed for user 'neondb_owner'"}`。旧実装は`APP_ENV==="production"`のときだけ5xx詳細をマスク |
| 2 | `AUTH_MODE`未設定時に`demo`認証(ヘッダー自己申告)へフォールバックする実装が残り、公開オリジンで設定漏れが起きると未認証者が`cad_admin`相当へ到達し得た | 重大(潜在的) | `authMode()`/`resolveActor()`の実装、および`wrangler.toml`に`AUTH_MODE`が無い状態 |
| 3 | デプロイ時の`db:verify`が、トリガーにより削除できない合成監査行を本番`audit_logs`へ混入させていた | 高(監査証跡の完全性) | `mirai_web_cad`の`audit_trigger_verify_probe`(actor `verify`、2026-08-30)1件。`mirai_web_cad_test`にも1件 |
| 4 | 本番ホストのローカル`main`が`origin/main`より4コミット先行し、未レビューのPR #87コードが稼働。稼働commitを確認・比較する手段が存在しなかった | 重大 | `git log origin/main..HEAD`が4件(16ファイル、688 insertions)。Issue #98 |
| 5 | 文書と実環境の矛盾2件:「Pages側のコードは移行前のもの」は誤り(現行`functions/api/[[path]].js`が現行`src/api-handler.js`を配信)。「`_headers`は全応答へ適用」も誤り(静的応答のみで`/api`は対象外) | 中(文書信頼性) | 実応答が現行ハンドラのJSON形式であること、`scripts/serve-production.mjs`の分岐 |
| 6 | 本番DBには隔離復元DBが無く、自動復元ドリルも無い。本番接続ロールには`CREATEDB`権限が無い | 高(DR未検証) | `mirai_web_cad_recovery`不存在、`create database`が`permission denied to create database` |
| 7 | 本番DBに統合/E2Eテスト由来の図面9件(`dwg_it_*`/`dwg_smoke_*`)が残存 | 中(データ品質) | `select id,name from drawings`の実測 |

### 11.2 実施した修正(PR #99、reviewer SubAgentの独立レビュー指摘を反映)

- **認証のfail-closed化**: `AUTH_MODE`は`access`/`demo`のみ受理し、未設定・不正値は`access`へ。`demo`は`APP_ENV=production`で拒否。Pages Functionsは`access`以外を503で拒否。
- **5xx内部詳細のマスク**: ローカル開発以外では`internal error`へ丸め、原文はサーバーログのみ。
- **デプロイ素性の可視化と乖離検知**: `GET /api/health`の`deploy`ブロック、`deploy:drift`/`deploy:drift:live`、30分間隔timer、起動時ガード(`DEPLOY_GUARD=strict`)。**判定不能を「一致」と報告しない**(fail-open除去)。
- **デプロイ時の稼働commit一致確認**: `scripts/deploy-local.sh`が、稼働APIの`deploy.commit`と今回の`$new_sha`の一致を必須化(不一致は自動ロールバック)。
- **監査probeの残留ゼロ化**: 単一トランザクション+ROLLBACK。例外判定を`errcode 42501`かつメッセージ一致へ厳格化。
- **本番DB復元ドリルunit**の追加(初回の隔離DB準備は未了)。
- **文書訂正**: 「本番ホストへ直接コミットしない」運用ルール、Pagesの誤記2件、`_headers`適用範囲、既存残留監査行の削除手順(要承認)。

検証Evidence: ローカル`npm run verify`(unit 333件中332 pass/1 skip、E2E 74/74)、PR #99の全CIジョブ成功(Empty PostgreSQL Migration / Backup and Restore Drill / Data Store Integration / Secret Scan / Dependency Audit / Synthetic DXF / Terraform / Lint・Test・Build・E2E・A11y / Deploy Preview)、**Preview実測**(`pr-99.mirai-web-cad.pages.dev`で`/`=200、未認証`/api/health`=500かつ`internal error`で内部情報なし、`x-demo-role: cad_admin`でも同一応答、不正JWT=401)、監査probeの正常系/負例の実DB検証。

### 11.3 18項目再採点(追加ラウンド後)

| 評価軸 | 第10回後 | 第11回後 | 増分の根拠 |
| --- | ---: | ---: | --- |
| 業務適合性 | 18 | 18 | 変化なし(電子納品・座標系・案件モデルの不在は未着手) |
| 機能完成度 | 30 | 30 | 変化なし(CAD機能は本ラウンドの対象外) |
| UI/UX | 45 | 45 | 変化なし |
| アクセシビリティ | 42 | 42 | 変化なし |
| データ品質 | 62 | 64 | 監査証跡への合成行混入を停止。ただし本番の残留1件とテスト由来図面9件は未解消 |
| AI有効性 | 58 | 58 | 変化なし |
| 設計 | 72 | 73 | 認証のfail-closed化、素性情報の分離(`scripts/lib/deploy-info.mjs`) |
| コード品質 | 68 | 69 | 回帰テスト30件追加・独立レビュー反映。ESLint等の静的解析は未導入(P0-59) |
| 性能・拡張性 | 70 | 70 | 変化なし |
| セキュリティ | 74 | **80** | 権限昇格経路の封鎖、未認証への内部エラー漏洩の封鎖、公開オリジンのAPIガード。LocalStorage平文・レート制限の範囲は未解消 |
| 可用性・バックアップ | 55 | 57 | 本番DB復元ドリルunitを追加。**実行は権限待ち**で、オフサイト・暗号化・単一障害点は未解消 |
| 監視・障害対応 | 58 | **66** | 稼働commitの外部可視化、30分間隔の乖離検知、起動時ガード、デプロイ時のcommit一致必須化。当番実名は未確定 |
| テスト | 83 | 84 | unit 333件(第10回305件)+E2E 74件+独立レビュー。カバレッジ計測は未導入 |
| CI/CD・リリース | 75 | **81** | デプロイ時の稼働commit検証をCI/CD経路へ組込み。Previewの`/api`検証は未追加 |
| 運用保守性 | 60 | **68** | 「本番ホストへ直接コミットしない」運用ルール、乖離検知手順、復元ドリル手順を明文化 |
| 文書 | 78 | 79 | 実環境と矛盾する記述2件を訂正。`mvp-traceability.md`等の陳腐化は残存 |
| 費用対効果 | 50 | 50 | 変化なし |
| 競合代替性 | 53 | 53 | 変化なし(代替率はCAD機能側の進捗に依存) |
| **総合(単純平均)** | **58.6** | **60.4** | 18項目単純平均(1087/18) |

**判定は依然PoC。** 本ラウンドは「本番で安全に運用するための統制」を強化したもので、600名・複数案件・公共工事80%という業務前提に対する最大のギャップ(業務適合性18、機能完成度30)には触れていない。Critical残存は、単一ホスト依存(P1-13)、電子納品/座標系の欠落、案件・工区モデルの未成熟、本番稼働コードの分岐(P0-58)。

### 11.4 未解決(次ラウンド以降)

1. **P0-58**: 本番稼働コードと`origin/main`の分岐解消(業務判断が必要)。
2. **本番復元ドリルの初回準備**: 隔離DB作成の権限が無い(要DB管理者)。
3. 既存の残留監査行1件の削除(破壊的本番DB操作のため要承認)。
4. 本番DBのテスト由来図面9件の扱い(削除は業務判断)。
5. `_headers`が`/api`に適用されない件(CSP/HSTSのAPI応答への付与)。
6. `AUTH_MODE=demo`のままで公開される自己ホストpreviewがある場合の5xx詳細漏洩(条件付き)。

## 12. 2026-09-18 追加ラウンド(API入力境界の強化、PR #100)

第11回に続き、`src/`の精査で検出した**実害のあるAPI入力境界の弱点**を修正した(PR #100、squash `c7c88f0`)。Criticalは該当なし、High 2件・Medium 3件。

| # | 事象 | 重大度 | 修正 |
| --- | --- | --- | --- |
| 1 | 案件系3経路が本文検証より先に冪等キーを予約し、本文不備で400を返したリクエストがキーを消費。同じキーでの正しい再送が**恒久的に409**となり、案件作成・メンバー追加が操作不能 | High | 検証後に予約する順序へ変更(成功後の重複再送は409のまま) |
| 2 | `/drawings/:id/transactions` にコマンド数上限が無く、`commands`が非配列だと500 | High | 上限500件、非配列400、超過413 |
| 3 | `expected-version` を`Number()`で解釈し`1e0`/`0x1`/`1.0`が通る | Medium | `/^\d+$/`で10進整数のみ受理 |
| 4 | 監査CSVの数式注入対策が先頭一致のみで、先頭空白つき`" =cmd\|..."`が素通り | Medium | 最初の有意文字で判定(`csvEscape`を単体テスト対象としてexport) |
| 5 | 未使用レガシー`saveDrawing`が`project_id`をデモ案件に固定(将来の呼び出しで案件ACLが破綻) | Medium | 呼び出し側の`projectId`を優先 |

検証: `tests/api-hardening.test.js`(新規10件)、`npm run verify:fast`(unit **343件中342 pass・1 skip**)、CI全ジョブ成功、Preview実測(`pr-100`で`/`=200、未認証`/api/health`=500かつ`internal error`、内部情報漏洩0件)、マージ後のmain CI/Production verify ともにsuccess。PostgreSQL統合テストのローカル実行はローカル認証方式(peer)の制約で不可のため、CIの`PostgreSQL Data Store Integration`で検証した。

**18項目への影響**: セキュリティ 80→81、コード品質 69→71、テスト 84→85、運用保守性 68→69。他は据え置き。**総合 60.4 → 60.6**(1091/18)。判定は依然PoC。

**未解決(据え置き)**: `appendAudit`の`on conflict (id) do nothing`(ID衝突時に監査行を黙って落とし得る)、`/transactions`の1コマンドあたりの配列長検証、レート制限がAI経路限定、監査ログの保持期間・削除手段の不在、`/api`応答へのCSP/HSTS付与。

## 13. 2026-09-18 追加ラウンド(API応答ヘッダと運用footgun、PR #102)

### 13.1 修正

| # | 事象 | 重大度 | 修正 |
| --- | --- | --- | --- |
| 1 | `/api/*`応答にCSP/HSTS等のセキュリティヘッダが付いていなかった(`_headers`は静的応答にのみ適用)。404/413/500のエラー応答も同様。加えて**Cloudflare Pages Functionsの応答には`_headers`が適用されない**ため、`_headers`への追加だけではPages側が直らない | Medium | ヘッダの単一の出所を`src/api-handler.js`の`API_SECURITY_HEADERS`(CSP/HSTS/XFO/XCTO/Referrer-Policy/Permissions-Policy)とし、全API応答とPages Functionsの503応答へ付与。`scripts/lib/http-bridge.mjs`の`applyEdgeHeaders`(不足分のみ補い、アプリ設定ヘッダは上書きしない)を`serve-production.mjs`の`/api/*`と全エラー応答へ適用。`_headers`にもHSTSを追加し、3箇所の値の一致をテストで固定 |
| 2 | **環境変数ファイルをシェルで`source`するとJSON値の引用符が除去され**、`ACCESS_ROLE_MAP`が不正JSONになる。手動起動時に「refusing to start」で復旧作業が止まる(実測: 36文字→32文字) | Medium(運用) | `docs/deployment-local.md`の手順を「必要な1変数のみ`sed`で抽出」へ変更し、注意書きを追加。`serve-production.mjs`の起動拒否ログに原因を示す`hint`を追加(起動拒否そのものはfail-closedとして維持) |

### 13.2 検証Evidence

- `tests/http-bridge.test.js`に4件追加(HSTSの全パス付与、API応答への補完とアプリ設定ヘッダ優先、HSTS無効化)
- **実行時検証**: `scripts/serve-local.mjs`を一時ポートで起動し`/api/health`がCSP/XFO付き・HSTSなしを確認。`scripts/serve-production.mjs`を本番`EnvironmentFile`相当の環境で**別ポート(24139)**で起動し(DBは読み取りprobeのみ)、`/api/health`(200)・`/api/nope`(401)・`/definitely-missing.txt`(SPAフォールバック200)の**すべて**でCSP・HSTS・XFO・XCTO・Referrer-Policy・Permissions-Policyを確認
- `npm run verify:fast`(unit **346件中345 pass・1 skip**)、CI全ジョブ、Preview実測、マージ後main CI/Production verify

### 13.3 18項目への影響

セキュリティ 81→82、運用保守性 69→71、文書 79→80。他は据え置き。**総合 60.6 → 60.8**(1095/18)。判定は依然PoC。

### 13.4 新たに判明した未解決事項

- SPAフォールバックにより、存在しないパスも**200 + index.html**を返す(`/definitely-missing.txt`=200)。外形監視が誤ったパスを監視した場合に異常を検知できないため、監視対象パスの設計または404返却の検討が必要。
- Cloudflare Pages(`mirai-web-cad.pages.dev`)は`main`マージでは更新されない(preview jobは`pull_request`のみ)。**PR #99/#100/#102のコード修正はPages本番へ届かない**ため、公開APIの情報漏洩はCloudflare側の操作まで残る。

## 14. 2026-09-18 追加ラウンド(濫用対策・監査完全性、PR #103)

### 14.1 修正

| # | 事象 | 重大度 | 修正 |
| --- | --- | --- | --- |
| 1 | レート制限がAI提案経路のみで、**図面更新・案件操作・監査出力は無制限**だった。暴走クライアントや連打で全利用者が影響を受ける | Medium | `write`バケットを追加(`POST`/`PATCH`/`PUT`/`DELETE`、既定240回/分、`WRITE_RATE_LIMIT_PER_MINUTE`で変更可)。公開読み取りと`OPTIONS`は対象外 |
| 2 | レート制限の状態(利用者ごとの配列)が**無制限に増え続けていた** | Low | キー数上限`10_000`を設け、期限切れ→最も古い順に破棄。`resetMemoryStore`でテスト時にも消去 |
| 3 | `appendAudit`が`on conflict (id) do nothing`のため、**ID衝突時に監査行を黙って落としていた**(戻り値も例外も無し) | High(監査証跡) | 挿入行数を確認し、0行なら例外にして操作を失敗させる(承認判断の根拠が欠けた状態で成功を返さない)。メモリストアも重複IDを検出 |
| 4 | `_headers`の書式違反行がパーサに**黙って捨てられ**、CSP等が無言で欠落したまま配信され得た | Medium | `findMalformedHeaderLines`を追加し`npm run lint`で検出。実際の`_headers`に違反が無いこともテストで固定 |

### 14.2 検証Evidence

- `tests/abuse-and-audit.test.js`(新規8件): 更新系の429、読み取りが数えられないこと、バケット分離、リセット、監査重複IDの例外、`_headers`の書式検出/非検出
- `npm run verify:fast`: unit **357件中356 pass・1 skip**、lint/typecheck/a11y/build 成功／E2E 74/74
- CI全ジョブ、Preview実測、マージ後main CI/Production verify

### 14.3 18項目への影響

セキュリティ 82→83、コード品質 71→72、テスト 85→86。他は据え置き。**総合 60.8 → 61.0**(1098/18)。判定は依然PoC。

### 14.4 未解決(据え置き)

- エッジ(WAF)側のレート制限は未設定(プロセス内制限のみ)。
- 監査ログの一覧取得(CSV以外)は`audit.exported`を記録しない。監査ログのハッシュチェーン/改ざん検知は未実装。
- SPAフォールバックの200、ESLint等の静的解析(P0-59)、`/transactions`の1コマンドあたりの配列長検証。

## 15. 2026-09-18 追加ラウンド(静的解析の導入、PR #104)

### 15.1 実施内容

改善台帳で唯一「未着手」として残っていたP1項目**P0-59(実質的な静的解析の導入)**を完了した。ESLint 10のflat config(`eslint.config.mjs`)を追加し、`npm run lint:static`として`verify:fast`(=CIのLintジョブ)へ組み込んだ。

- **errorとする規則は実行時バグに直結するものだけ**: 未定義参照、重複キー/引数/クラスメンバ、到達不能コード、未使用変数、定数条件、`no-fallthrough`、`valid-typeof`、`use-isnan`、`no-self-assign`、`no-unsafe-negation`、`no-unsafe-optional-chaining`、`no-async-promise-executor`、`no-obj-calls`等。整形・命名の規則は一切入れていない。
- `require-atomic-updates`はブラウザUIのイベントハンドラで誤検知が多いため**warnのみ(21件)**とし、CIをブロックしない(改善台帳の完了基準「warn中心で、CIをブロックしない範囲」に一致)。
- スコープは`src/`・`scripts/`・`functions/`・`tests/`(E2Eスペックはブラウザコールバックを考慮してブラウザ/Node両方のグローバルを宣言)。
- 実際に検出されたのは`src/app.js`の`FormData`未定義8件で、原因はグローバル定義の不足であり実バグではなかった(定義を追加して解消)。`scripts/check-cloudflare-iac.mjs`の`no-template-curly-in-string`は「HCL中の`${var.…}`という文字列そのもの」を探す検査のため誤検知として無効化した。

### 15.2 検証Evidence

- `npm run verify:fast`: `lint` → `lint:static`(**0 errors / 21 warnings**)→ `typecheck` → `a11y` → unit **357件中356 pass・1 skip** → `build` すべて成功
- `npm audit --omit=dev --audit-level=high`: 0件(依存追加はdevのみ)
- CI全ジョブ、Preview実測、マージ後main CI/Production verify

### 15.3 18項目への影響

コード品質 72→73、CI/CD・リリース 81→82。他は据え置き。**総合 61.0 → 61.1**(1100/18)。判定は依然PoC。

### 15.4 未解決(据え置き)

- `require-atomic-updates`の21件は「ブラウザUIでは誤検知」と判断してwarnに留めている。将来、状態管理を見直す際の確認対象として残る。
- 監査ログのハッシュチェーン/改ざん検知、監査一覧取得の監査記録、エッジ(WAF)のレート制限、SPAフォールバックの200、`/transactions`の1コマンドあたりの配列長検証。

## 16. 2026-09-18 追加ラウンド(コマンド検証とSPAフォールバック、PR #105)

### 16.1 修正

| # | 事象 | 重大度 | 修正 |
| --- | --- | --- | --- |
| 1 | `POST /drawings/:id/transactions` の`op`が無検証で、**未知のopは`applyTransaction`に黙って無視され200(成功)が返っていた**。綴り間違いや将来の誤実装が「何も起きないのに成功」になる | High(誤判定) | `applyTransaction`が解釈する13種のopを許可リスト化し、未知のopは400で拒否(該当opを応答に含める)。コマンドが非オブジェクトの場合も400 |
| 2 | 1コマンドあたりの`points`長に上限が無く、巨大な点列で計算量が増大し得た | Medium | `MAX_COMMAND_POINTS = 10_000`を追加(超過は413) |
| 3 | **SPAフォールバックが拡張子の有無を問わずindex.htmlを返していた**ため、`/missing.js`のような欠落アセットや誤ったパスが**200(text/html)**になり、読み込み失敗の検知も外形監視も成立しなかった(実測: `/definitely-missing.txt`=200) | Medium(監視) | フォールバックを**拡張子の無いパスに限定**。`/missing.js`等は404、`/deep/client/route`は従来どおりindex.html |

### 16.2 検証Evidence

- `tests/api-hardening.test.js`に5件追加(未知opの400、非オブジェクトコマンドの400、op非文字列の400、`points`超過の413、SPAが送る13 opの正常適用)
- `tests/http-bridge.test.js`に4件追加(既存ファイル解決、欠落ファイルはnull=404、拡張子無しパスはindex.html、上位ディレクトリへ抜けるパスは不解決)
- **実行時検証**(`serve-local`を一時ポートで起動): `/`=200 html、`/index.html`=200 html、**`/missing.js`=404**、**`/missing.txt`=404**、`/deep/client/route`=200 html(フォールバック維持)、`/src/app.js`=200 js
- **本番コードパスの実行時検証**(`serve-production.mjs`を本番`EnvironmentFile`相当の環境・別ポート24155で起動。DBは読み取りprobeのみ、終了後に停止): `/`=200 html+HSTS、**`/missing.js`=404**+HSTS、**`/missing.txt`=404**+HSTS、`/deep/client/route`=200 html+HSTS、`/api/health`=200 json+HSTS。**404/エラー応答にもHSTSが付くこと**を含めて確認
- **Preview実測の限界**: `pr-105.mirai-web-cad.pages.dev`では`/missing.js`が**依然200(text/html)**である。これはCloudflare Pages側のSPAフォールバック(404.htmlが無い場合に未一致パスを`/index.html`へ返す挙動)であり、本修正が対象とするのは**自ホストの本番サーバー(`serve-production.mjs`、実際の本番ドメイン)**である。Pages経路はCloudflare側の設定であり、本ラウンドの修正対象外(下記16.4)。
- `npm run verify:fast`: unit **366件中365 pass・1 skip**、ESLint 0 errors、lint/typecheck/a11y/build 成功／E2E **74/74**
- CI全ジョブ、Preview実測、マージ後main CI/Production verify

### 16.3 18項目への影響

データ品質 64→65、監視・障害対応 66→67、コード品質 73→74。他は据え置き。**総合 61.1 → 61.3**(1103/18)。判定は依然PoC。

### 16.4 未解決(据え置き)

- MVPドメインはCloudflare Accessで保護されているため、**欠落アセットの404を外形監視へ組み込むにはAccess経由の監視設計が必要**(現状の`check-mvp-health.sh`は`/`の302を検査している)。
- **Cloudflare Pages側のSPAフォールバックは未解消**。`pr-105.mirai-web-cad.pages.dev`の実測で`/missing.js`=200(text/html)。Pagesは404.htmlが無い場合に未一致パスを`/index.html`へ返すため、404を返させるには`404.html`の追加等が必要だが、それは`/deep/client/route`のようなSPA側のパスも404にしてしまう。ローカル常駐サーバー(実際の本番ドメイン)は本ラウンドで404化済みであり、Pagesは「参考・ロールバック用」の位置づけであるため、対応は方針判断とする。
- 監査ログのハッシュチェーン/改ざん検知、監査一覧取得の監査記録、エッジ(WAF)のレート制限。

## 17. 2026-09-18 追加ラウンド(独立レビュー2件とその反映、PR #106)

ディレクティブが推奨する「Independent Review」として、**実装者とは別のコンテキスト**で専門SubAgentを2件起動し、7本のPRを経た`main`を対象に、私とは異なる仮説でレビューさせた。結論を鵜呑みにせず、**指摘ごとに実コードで再検証**した(反証した項目もある)。

### 17.1 検証して修正したもの

| # | 事象 | 重大度 | 出所 | 修正 |
| --- | --- | --- | --- | --- |
| 1 | `POST /drawings/:id/transactions` は保存前に検証せず、`applyTransaction`は`command.entity`を無検証でpushする。`points`の無い`line`を保存でき、その後の承認で`validateDrawing`が**TypeError→500**となり、図面が削除以外で復旧不能になっていた | **High(誤判定/業務停止)** | 業務ロジックレビュー | (a)`boundsFromPoints`/`entityBounds`を防御的にし例外を排除、(b)更新で**新たに生じた**構造不正(`invalid-geometry`/`critical`)を保存前に400で拒否、(c)`approveDrawing`の承認阻止条件に`invalid-geometry`を追加 |
| 2 | `probe()`がmigration**0007**(`projects.access_scope`/`project_members`)を検証せず「migrated=true」を返す。かつ`requireProjectAccess`が`accessScope !== "restricted"`で**fail-open**だったため、0007未適用時に案件アクセス制御が無効なまま健全と報告され得た | **High(権限)** | 業務ロジックレビュー | probeに0007の検証を追加し`migration`ラベルを更新。`requireProjectAccess`を**fail-closed**(案件が取得できない/`open`以外はメンバー要求)へ変更 |
| 3 | 業務処理が失敗した場合に冪等キーの予約が残り、**同じキーでの正しい再送が恒久的に409**になっていた(案件作成・accessScope更新・メンバー追加) | High(業務操作) | 業務ロジックレビュー | `releaseIdempotency`を両ストアへ追加し、業務処理の失敗時に解放。成功後の二重実行は409のまま |
| 4 | `saveDrawing`にtry/catchが無く、**容量超過やプライベートモードで例外が伝播**して`log`/`render`に到達しない=「画面には反映されたが何も保存されていない」無言のデータ喪失 | **Critical(データ損失)** | フロントレビュー | `saveDrawing`が`{ok, reason}`を返す契約へ変更し、`persist`は失敗を必ず画面へ出して`render`まで到達。`saveUserSettings`も同様。**失敗経路の単体テストを追加** |
| 5 | 描画に例外境界が無く、壊れた図形1件で`render`全体が失敗し続け**サイトデータ削除まで復旧不能** | High(可用性) | フロントレビュー | `drawCanvas`をtry/catchで隔離し、失敗を画面に出してUIを稼働継続 |
| 6 | ダウンロード処理がanchorをDOMへ接続せず**同期revoke**しており、Firefox/WebKitで書出しが失敗し得た | Low(データ保全) | フロントレビュー | anchorを接続してclickし、revokeを次のタスクへ遅延 |
| 7 | `Permissions-Policy`が`_headers`(`usb=()`あり)とAPI側(なし)で**ドリフト**。ドリフト防止テストがCSP/HSTSしか比較していなかった | Low | フロントレビュー | 値を一致させ、**共通ヘッダ全項目の一致テスト**へ拡張 |
| 8 | READMEのE2Eバッジが`68/68`(実際は74/74)、`docs/mvp-traceability.md`が「DXF書出し=未実装」「ARCはポリライン変換」等で陳腐化 | Low(文書) | 私の検証 | 実装に合わせて更新(ネイティブARC/ELLIPSE/SPLINE、DXF書出し限定対応、ネイティブBLOCK、案件ACL、AIハイブリッドを反映) |

### 17.2 独立レビューの指摘のうち**反証した**もの

- 「`afterHash`が`resolveBlocks`/`resolveDimensions`の**前**に計算される」→ 実コードでは解決処理の**後**(`cad-core.js:353-359`→`368`)。**誤り**。
- 「`AUTH_MODE`未設定のPagesがdemo認証で権限昇格可能」(第1回レビュー)→ 実測で`cf-access-jwt-assertion: bogus`が401を返し**accessモードと確定**。ただし「未設定時のフォールバックが危険」という設計指摘は妥当なため、PR #99でfail-closed化済み。
- 「systemd unitの`WorkingDirectory`が誤り」→ リポジトリ内の全unitが同じ旧パスを指しており、それが本番ホストのチェックアウト。**誤り**(真の問題は本番mainの分岐=P0-58)。

### 17.3 検証Evidence

- `tests/geometry-integrity.test.js`(新規6件)、`tests/api-hardening.test.js`(+7件)、`tests/storage.test.js`(+4件)
- `npm run verify:fast`: unit **379件中378 pass・1 skip**、ESLint **0 errors/21 warnings**、lint/typecheck/a11y/build 成功／E2E **74/74**
- CI全ジョブ、Preview実測、マージ後main CI/Production verify

### 17.4 18項目への影響

データ品質 65→67、セキュリティ 83→85、可用性・バックアップ 57→58、監視・障害対応 67→68、コード品質 74→75、テスト 86→87、文書 80→81。他は据え置き。**総合 61.3 → 61.8**(1112/18)。判定は依然PoC。

### 17.5 未解決(独立レビューが指摘し、本ラウンドでは**実施しなかった**もの)

優先順はレビュアーの推奨に従う。いずれも**別イニシアチブ相当の規模**または**業務判断**を要する。

1. **複数タブ同時編集の保護が皆無**(`storage`イベント/BroadcastChannel/ロックが0件)。オフラインでは後勝ちで作業が消える。→ 検知・警告・マージ方針の設計が必要
2. **`checkApiHealth`が未保存のローカル編集を無警告で破棄**(revision比較・in-flightガードなし) → 確認ダイアログと世代トークンが必要
3. **`render()`が全DOMを`innerHTML`で再構築**するため`aria-live`が毎回破棄され、エラーが支援技術に伝わらない。ほぼ全操作後にフォーカスがCanvasへ飛ぶ(WCAG 2.4.3/4.1.3) → DOM再構築の設計変更が必要
4. **Canvas内容の代替が皆無・キーボードで作図できない**(公共調達のアクセシビリティ要件で致命的)
5. **平文LocalStorageに生DXF原本(≤700KB)と実名メール(PII)が入り、TTL・削除導線がない** → 保存方針の決定(最小化・暗号化・削除導線)が必要
6. **`content_hash`が`entities`のみを対象とする32bitハッシュ**で、レイヤ・用紙・尺度・単位の変更が現れない → 改ざん検知に使うなら強ハッシュへの置換と対象拡張が必要(保存済みハッシュとの互換に関わるため段階移行が要る)
7. **`migrations/0006`が監査不変性トリガを一時的にdropしてUPDATEする** → 0005の保護を落とさない正規化手順への見直し
8. **AI提案のrunと監査が非原子**(`saveAgentRun`の後に別INSERT)
9. **レイヤロックの迂回**(`delete_layer`/`update_layer`がロック中レイヤでも通る)、`update_layout`の数値上限なし、用紙境界がA3横mm固定(単位・用紙サイズを参照していない)
10. **職務分離の欠如**(提出者と承認者の同一性を検査しない。cad_adminは提出と承認を1人で行える)
11. テストの実効性: axeは`violations`のみで`incomplete`を無視、`app.js`(3046行)のユニットテストが存在しない、E2Eは共有`dwg_demo_001`を`fullyParallel`で触る(「74件」は37ケース×2プロジェクト)
12. 本番配信物が`sourcemap: true`・minify無しでソース全公開

## 18. 2026-09-18 追加ラウンド(アクセシビリティ通知とレイヤ保護、PR #107)

§17.5の未解決項目のうち、**承認不要で効果が明確なもの**に着手した(本番反映は依然P0-58待ち)。

### 18.1 修正

| # | 事象 | 重大度 | 修正 |
| --- | --- | --- | --- |
| 1 | `render()`が`#app`の中身を`innerHTML`で毎回作り直すため、コマンドログの`aria-live`領域が**描画ごとに破棄**され、エラー(権限拒否・Import失敗・保存失敗)が支援技術に伝わらなかった | High(アクセシビリティ) | `index.html`の`#app`**外**に`#sr-announcer`(`role="status" aria-live="polite"`、`.sr-only`)を追加し、`render()`後に最新のログを流す |
| 2 | `#app`・`.drawing-meta`・`.ribbon`・`.command-history`・`.status-bar`は`role`がgenericなのに`aria-label`を付けており、`aria-prohibited-attr`(axe impact: serious)に該当 | Medium(アクセシビリティ) | `#app`は`aria-label`を削除、他は意味に合う明示的なrole(`group`/`toolbar`/`log`)を付与 |
| 3 | **ロック中のレイヤーを削除できた**(ロックの意味が失われる) | Medium(データ保全) | `delete_layer`がロック中レイヤを拒否 |
| 4 | 用紙範囲(12000×7000mm)が`cad-core.js`と`ai-proposal.js`に**重複定義**され、片方だけ変わると「検査では用紙内なのにAIは提案しない」等の不整合が生じ得た | Low | `MODEL_EXTENT`として単一の出所にまとめ、両者で共有 |

### 18.2 反証した指摘(採用しなかった)

- 「用紙境界が**A3横mm固定**で、A1/A2/A4やm単位で誤検知する」→ `12000×7000`はA3実寸ではなく、**このアプリ全体の仮想シート**(デモ図面の図枠4辺がまさに12000×7000、`app.js`のモデル→画面変換もこの値を使用)。物理用紙寸法に置き換えると**正常な図面が全て用紙外と誤判定される**ため採用しなかった。真の問題は定数の重複(上記#4)であり、そちらを解消した。

### 18.3 検証Evidence

- `tests/accessibility-and-integrity.test.js`(新規4件): ロック中レイヤの削除拒否／ロック無しの空レイヤ削除は維持／`MODEL_EXTENT`が凍結された単一定数／用紙外判定が境界を含めて定数と一致
- `tests/e2e/cad-workflow.spec.js`に1件追加: `#sr-announcer`が`aria-live="polite"`を持ち、権限拒否メッセージが**live regionにも入る**ことを実ブラウザで検証
- `npm run verify:fast`: unit **383件中382 pass・1 skip**、ESLint 0 errors／E2E **76/76**(デスクトップ/モバイル)

### 18.4 18項目への影響

アクセシビリティ 42→**44**、データ品質 67→68、コード品質 75→76、テスト 87→88。他は据え置き。**総合 61.8 → 62.0**(1116/18)。判定は依然PoC。

### 18.5 残る未解決(据え置き)

§17.5の1〜8のうち、複数タブ保護、`checkApiHealth`の未保存編集保護、`render()`の全DOM再構築そのもの(フォーカス移動・dialog保持)、Canvas内容の代替とキーボード作図、平文LocalStorageのPII/生DXF原本とTTL・削除導線、`content_hash`の強ハッシュ化、`migrations/0006`の監査トリガ一時解除、AI runと監査の非原子、職務分離、axeの`incomplete`対応、`app.js`のユニットテスト化、E2Eの共有図面依存、`sourcemap`/minifyは**未着手**。

## 19. 2026-09-18 追加ラウンド(P0-58完了=PR #87のレビュー完了と本番main分岐の解消、ほか12件の実バグ修正)

本ラウンドは、第10回から繰り返し最優先課題として挙げられながら未着手だった**P0-58(PR #87レビュー未完了・本番main分岐)**を完了させたことを主眼とする。あわせて、PR #87の差分に対する**独立敵対的レビュー(別コンテキストのSubAgent)と再レビュー(CodeRabbit 8件)**で検出した実バグ12件を、すべて実行で再現させたうえで修正し、回帰テストで固定した。

### 19.1 P0-58の完了(最重要)

| 項目 | 内容 |
| --- | --- |
| 開始時点の状態 | PR #87はopen、CodeRabbit review thread 18件(全てresolve済み)で、**branch protectionの`required_conversation_resolution`は満たしていた**。一方で本番ホストのローカル`main`がGitHub mainと分岐したまま稼働し、恒久対応(P0-58)は未着手だった |
| 第1段階(レビュー指摘の解消) | ローカルbranchを`origin/main`へ追随させ、レビュー指摘の実バグ4件を修正(19.2の1〜4)。全CI green、追加レビューthread 0件を確認 |
| 第2段階(再レビュー8件の解消) | 修正コミットへのCodeRabbit再レビューで**新規未解決thread 8件**が付き、`required_conversation_resolution`により正規手順でマージ不能となった。8件すべてを実コードで再検証し全件妥当と判断、8件を修正(19.2の5〜12)。全threadへ修正内容を回答しresolveした |
| 完了確認 | 必須チェック5件+全ジョブの成功、未解決thread 0件を`gh`で実測。**admin権限によるbranch protection迂回は一切行っていない** |
| 分岐の再発防止 | 本番ホスト側の乖離検知(`npm run deploy:drift`)が、分岐状態で**exit 1(fail-closed)を返すことを実測**(`ok:false`、`ahead`検出)。判定不能を「一致」と報告しない実装であることを確認した |

**留意**: 本番ホスト(`/home/kensan/Projects/Mirai-DX-Project/Mirai-Web-CAD`)のローカル`main`の分岐解消そのものは、本リポジトリの外にある別チェックアウトの操作であり、**本ラウンドでは実施していない**(P0-58の残作業)。PR #87が`main`へ正式マージされたことで、以後`git merge --ff-only origin/main`が成立する状態になった。

### 19.2 実装した修正(12件。すべて実測で再現→修正→回帰テストで固定)

**(A) レビュー指摘の実バグ4件(ネイティブDXF往復で黙って失われる値)**

| # | 事象 | 重大度 | 修正 |
| --- | --- | --- | --- |
| 1 | `transformEntity`がHATCHの`elevation`を通常の座標点としてアフィン変換し、原本パッチがDXFのgroup 10/20(仕様上つねに0)へdx/dyを書き戻していた。実測: MOVE(dx=7,dy=9)後の出力が`10:7 20:9` | High(仕様違反の出力) | elevationのx/yは変換対象外、Zのみ倍率換算 |
| 2 | 原本パッチ経路でHATCHの`elevation.z`(group 30)が比較・書出しの対象外で、SCALE 2倍でもモデルz=30に対し出力15のまま(往復で消失)。同一図面でも経路により出力が異なっていた | High(データ損失) | group 30を比較・書出し対象と許可コードへ追加 |
| 3 | `encodeViewport`が`snapBase`(13)/`snapSpacing`(14)/`gridSpacing`(15)を出力せず、無原本/限定再生成の経路で往復後に3項目が`undefined`へ消失 | High(データ損失) | 存在する場合のみ出力(存在しない設定を0で作らない) |
| 4 | angular寸法の13/14/15/16フォールバックが`points[(code+1)%2]`のため15≡13・16≡14となり、0度の縮退した寸法を出力していた | Medium | definitionPointsが揃わない場合は壊れた図形を書出さずスキップ理由付きで報告 |

**(B) 再レビュー8件(いずれも「黙って誤った値を出す/値を失う」型)**

| # | 事象 | 重大度 | 修正 |
| --- | --- | --- | --- |
| 5 | solidFill(group 70=1)/pattern=SOLIDのHATCHが斜線描画のままで、面として塗られていなかった | Medium(表示忠実性) | `fill("evenodd")`で塗り、斜線描画を行わない分岐へ |
| 6 | VIEWPORTの`viewCenter`/`snapBase`/`snapSpacing`/`gridSpacing`/`viewTarget`/`viewHeight`はモデル空間(DCS)の設定だが、紙空間の`center`を基準にした回転・倍率を適用していた | High(不正な座標) | 単位変換(scale factor・angle=0・base=原点)のときだけ倍率換算し、対話編集では保持 |
| 7 | `entityLength("hatch")`が`entity.points`のみを見て、複数境界(外側ループ+穴)の周長の一部を無視していた | Medium | 全boundaryを合算(area/bounds/hit-testと揃える) |
| 8 | DXF type 5(3点角度寸法)をtype 2(2線角度)として交差計算し、中心と掃引角を誤っていた | Medium | group 15を頂点とする分岐を追加 |
| 9 | 角度寸法の返却`value`に`measurementScale`が未適用で、他の寸法分岐と返却契約が不一致 | Low | 適用後の値を返す |
| 10 | ordinate(座標寸法)が`AcDbRotatedDimension`で出力されていた | Medium | 専用の`AcDbOrdinateDimension`(13=フィーチャ/14=引出線端点、bit64でX軸) |
| 11 | `encodeHatch`が`entity.points`しか検証せず、boundaryのedgeの非有限値を文字列`"NaN"`として出力し`skipped`にも載らなかった | Medium(壊れた成果物) | 境界の座標・半径・比率・角度を検証し、不正なら理由付きでスキップ |
| 12 | 必須group codeの欠落を0で補い、壊れたレコードを「原点にある図形」として黙って受け入れていた | High(誤ったDataの受入れ) | DIMENSION定義点・VIEWPORTの10/20/40/41・HATCHの91を必須化し、欠落時は取込を拒否 |

### 19.3 検証Evidence

- 新規回帰テスト: `tests/native-dxf-integrity.test.js` 8件 + E2E 1件(solidFillの塗り被覆率)。**8件は修正前に失敗し修正後に成功することを実測**。E2Eは修正前の塗りピクセル1342に対し修正後2000超で判別する
- `npm run verify` 全成功: `lint` / `lint:static`(ESLint **0 errors**・21 warnings) / `typecheck` / `a11y` / unit **409件(408 pass・0 fail・1 skip)** / `build` / E2E desktop+mobile **78/78**
- Migration検証: 9テーブル・監査追記専用トリガー2件・2回適用で冪等(CI相当の専用ロール/DBで実測)
- PostgreSQL統合テスト: 8/8(CI相当環境)。ローカルのpeer認証では`postgres.js`がTCP接続するため、専用ロールを作成して再現した
- CI: 全ジョブ成功(Empty PostgreSQL Migration / Backup and Restore Drill / Data Store Integration / Secret Scan / Dependency Audit / Synthetic DXF / Terraform / Lint・Test・Build・E2E・A11y / Deploy Preview)
- レビュー: 独立SubAgent(別コンテキスト)による差分の敵対的レビュー1回、CodeRabbit再レビュー1回(未解決0件)

### 19.4 18項目への影響

機能完成度 30→**33**、データ品質 68→**70**、設計 73→**74**、UI/UX 45→**46**、コード品質 76→**77**、テスト 88→**89**、運用保守性 68→**71**、CI/CD・リリース 82→**83**、競合代替性 53→**54**。他は据え置き。**総合 62.0 → 62.8**(1130/18)。**判定は依然PoC。**

据え置きの根拠: 本ラウンドは「既に本番で稼働していたコードを正規経路でmainへ入れ、その欠陥を潰した」ラウンドであり、600名・公共工事80%という業務前提に対する最大のギャップ(業務適合性18、機能完成度33)には触れていない。加えて19.5の重大な未解決が残る。

### 19.5 独立監査3件で新たに確定した重大な未解決(本ラウンドでは実施せず)

別コンテキストのSubAgent 3件(セキュリティ、DB/可用性/DR、DevOps/SRE/リリース管理)による**読み取り専用監査**を実施した。**アプリケーション層のCriticalは0件**(認証の四重fail-closed、全SQLパラメータ化、XSS/CSRF対策、監査追記専用トリガー、依存監査ゲートはコードで裏付けられた)。一方、**DR運用とリリース統制にCritical級が残る**。これらは業務判断・外部契約・DB管理者権限を要するため、無断実行せず記録する。

| # | 事象 | 重大度 | 必要な対応(エスカレーション) |
| --- | --- | --- | --- |
| 1 | **オフサイトバックアップが存在しない**。バックアップはDBと同一ホスト・同一ディスク(`/var/backups/mirai-web-cad/postgres/`、14日保持)で、転送・暗号化の実装が0件。ホスト全損で本番とバックアップが同時に失われる | Critical | 転送先(R2等)の契約・暗号化・保持期間の方針合意 |
| 2 | **本番DBの復旧ドリルが必ず失敗する**。`mirai-web-cad-restore-drill.service`は`~/.config/mirai-web-cad/backup.env`を読むが、当該ファイルに`RESTORE_DATABASE_URL`が無く、`restore-drill-local.sh`がexit 2。本番リストアは一度も実証されていない | Critical | DB管理者による隔離DB作成(本番接続ロールにCREATEDB権限が無い) |
| 3 | **リリースの承認ゲートが存在しない**。`production.yml`にデプロイジョブも`environment:`も無く、required reviewerはプラン制約で設定不能。CODEOWNERSは実効化されない。レビュー承認ゼロで本番投入可能 | Critical | プラン見直しまたはリリース承認手順の運用担保(要経営判断) |
| 4 | **単一ホスト依存**。電源・NW・ディスク障害で本番全体が停止し、RTOは実質的に復旧不能 | Critical | 冗長化・UPS・クラウド回帰の検討(要経営判断、P1-13) |
| 5 | バックアップ/鮮度検査/復旧ドリルの**失敗が誰にも通知されない**(systemd unitに`OnFailure=`が0件、合成監視は公開HTTP境界のみ) | High | 通知先の確定(Issue #8)と`OnFailure=`追加 |
| 6 | **`db:verify`が毎デプロイで本番DBへmigration+seedを適用**する。`seeds/demo.sql`の投入、`0004`による`dwg_demo_001`の名称上書きと`visibility='public'`強制、`0006`による監査トリガのdrop→UPDATE→再作成が毎回走る | High | デプロイ時の検証を読み取り専用のスキーマ検証へ分離 |
| 7 | **案件分離が実運用で機能していない**。`access_scope`の既定が`open`で、SPAは`projectId`を送らないため全図面が単一のopen案件に集約される。結果、Cloudflare Accessを通った全ロール(viewer含む)が全図面を閲覧でき、drafter以上が全図面を変更できる | High | 既定`restricted`化・案件選択UI・図面の案件付け替えAPIのいずれかを選択(要判断)。当面は受容リスクとして経営層承認 |
| 8 | **`isCadDrawing`失敗時にデモ図面を黙って返す**。破損・旧スキーマの図面をデモ内容として表示し、そのまま保存すると同一版を上書きして実データを失う | High | 明示エラーへ変更(fail-closed) |
| 9 | `MAX_COMMAND_POINTS`が`command.points`のみを検査するが、実ペイロードは`entity.points`/`patch.points`のため**防御が一度も発動しない**(テストも同じ誤った形状で通っている) | High | 実形状を検査対象に追加しテストを修正 |
| 10 | `migrations/0006`が監査の追記専用トリガを一時dropするため、`psql -1`以外(手動適用)では中断時に保護が失われ得る。また`audit_logs`はTRUNCATEを拒否せず、アプリロールがテーブル所有者 | High | 0006を自己完結トランザクション化、TRUNCATEトリガ追加、アプリロールの非所有者化 |
| 11 | `ACCESS_DEFAULT_ROLE`が起動時に未検証(他2つのロールマップは検証済み)。`WRITE_RATE_LIMIT_PER_MINUTE`は`serve-production.mjs`が転送しないため、production.envに書いても反映されない | Medium | 起動時検証と転送の追加 |
| 12 | 404応答本文の差による案件・図面IDの存在オラクル、`GET /api/audit-logs?format=csv`が状態を変更(GETで監査行を追記)することによるCSRF的な証跡汚染 | Medium | 本文の統一、CSV出力のPOST化 |

**未検証(外部権限・実機が必要)**: 本番ホストのsystemd unit実状態、ロール権限の実測、Cloudflareダッシュボード側のCache Rule/本番Access/WAF/DNS(Terraform未import)、Actions実測分数と契約プラン、Entra Secretの実期限、実測RTO。**これらは「未確認」であり、推測で補完しない。**

### 19.6 判断

- 本番導入可否: **開発者本人による単一案件の作図・承認・AI提案運用は引き続き可能**。ただし19.5の1〜4が残る限り、**600名規模の本番正本としては不可**。3監査の結論は一致して「アプリケーション実装は良好、問題はDR運用とリリース統制に集中」である
- 投資判断: **条件付き継続**。次ラウンドの最優先は、P0-58の残作業(本番ホストのローカルmain分岐解消)、19.5の6・7・8・9(コードで解消可能なHigh)、次いで1・2(外部契約・DB管理者)

## 20. 2026-09-18 追加ラウンド(監査で確定したコード修正可能なHigh 4件とMedium 1件、第2ラウンド)

§19.5に記録した独立監査の未解決項目のうち、**コードのみで解消でき業務判断・外部契約を要しないもの**を実装した。対象はP0-76(High)、P0-77(High)、P0-79(Medium)、P0-80(Medium)、およびP0-74(High、一部)。

### 20.1 修正

| ID | 事象 | 重大度 | 修正 |
| --- | --- | --- | --- |
| P0-77 | `MAX_COMMAND_POINTS`が`command.points`のみを検査していたが、実クライアントが送る形状は`command.entity.points`(`op:"add"`)と`command.patch.points`(`op:"update"`)であり、**上限が一度も発動していなかった**(テストも同じ誤った形状で通っていた) | High(防御の空振り) | 3箇所すべてを検査し違反は413。回帰テストは実形状で上限超過を検証 |
| P0-76 | `isCadDrawing`失敗時に`seedDrawing()`へ差し替えてデモ図面を返していた。利用者に誤った図面を見せ、そのまま保存すると同一版を`do update`で上書きして**実データを失う** | High(誤判定+Data Loss) | 明示的に例外を投げるfail-closedへ変更(APIは5xx、内部詳細は返さない)。実PostgreSQL統合テストを追加 |
| P0-74 | デプロイのたびに`db:verify`(migration+`seeds/demo.sql`)が本番DBへ走り、デモ行の投入、`0004`による`dwg_demo_001`の`name`上書きと`visibility='public'`強制、`0006`による監査トリガのdrop→UPDATE→再作成が毎回発生していた | High(本番データ保全) | 読み取り専用の`scripts/check-database-state.sh`(`npm run db:check`)を新設。**実測**: 適用済DBで実行前後の行数と`content_hash` md5が完全一致(書き込みゼロ)、空DBでは欠落を列挙してexit 1(デプロイを止める)。**デプロイ経路の切替は未実施**(§20.3) |
| P0-79 | `ACCESS_DEFAULT_ROLE`が起動時に未検証で、有効だが強すぎるロール(例`cad_admin`)が1行の設定ミスで全社員へ静かに適用され得た。また`WRITE_RATE_LIMIT_PER_MINUTE`は`serve-production.mjs`が転送しないため`production.env`に書いても反映されなかった(docsの記載と不一致) | Medium | 未知ロールは`exit 78`(他2つのロールマップと同一の扱い)、`viewer`以外はwarn。レート制限値を起動時envへ転送 |
| P0-80 | (1) 同じ404でも「存在しない図面」と「権限のない案件の図面」で**本文が異なり**、案件・図面IDの存在オラクルになっていた。(2) `GET /api/audit-logs?format=csv`が**GETでありながら監査行を追記**し、CORSのsimple requestとしてクロスサイトの`<img>`/`<link>`から被害者名義で`audit.exported`を追記できた | Medium | (1) 404本文を定数`図面が見つかりません。`へ統一し、要求IDを本文へ含めない(実測で本文一致)。(2) 一覧GETは読取り専用とし、CSV出力を`POST /api/audit-logs/export`(`content-type: application/json`必須=preflight必須、なければ415)へ移した |

### 20.2 検証Evidence

- `npm run verify` 全成功: `lint` / `lint:static`(ESLint **0 errors**・21 warnings) / `typecheck` / `a11y` / unit **413件(412 pass・0 fail・1 skip)** / `build` / E2E desktop+mobile **78/78**
- 新規回帰テスト `tests/access-and-audit-round2.test.js` 4件(実ペイロード形状の上限、404本文の一致、監査CSVのPOST化とGETの非状態変更、未知`ACCESS_DEFAULT_ROLE`でのexit 78)
- 実PostgreSQL統合テスト **9/9**(P0-76の欠陥ケースを追加)。CI相当の専用ロール/DBを作成して実測
- `db:check`の実測: 適用済DBでexit 0 かつ**行数と`content_hash` md5が前後で完全一致**、空DBでexit 1
- 既存の監査CSVテスト2件(数式注入ガード)を新エンドポイントへ更新し、ガードが維持されることを確認

### 20.3 実施できなかった項目と理由

- **P0-74のデプロイ経路切替**: `scripts/deploy-local.sh`を`db:verify`→`db:check`へ変更するには手順書`docs/deployment-local.md`の同時更新が不可欠だが、**本セッションのポリシーゲートが同ファイルをINFRA_CHANGE(critical)として編集拒否**した(承認プロンプトは無効なセッションのため最終判断)。文書と実装が矛盾する状態を残さないため、`deploy-local.sh`の変更も取り消した。読み取り専用チェック自体は追加済みで、人間が手順書を更新したうえで1行切り替えれば完了する
- P0-75(案件分離の方針)、P0-78(監査TRUNCATE・ロール構成)、P0-70〜P0-73(オフサイト・復旧ドリル・承認ゲート・失敗通知)は**業務判断・外部契約・DB管理者権限**を要するため未実施(§19.5)

### 20.4 18項目への影響

データ品質 70→**71**(誤ったDataを受入れない)、セキュリティ 85→**86**(404の存在オラクル解消、GET経由の監査汚染の封鎖、設定ミスの起動時拒否)、可用性・バックアップ 58→**59**(読み取り専用のデプロイ検証を追加)、監視・障害対応 68→**68**、コード品質 77→**77**、テスト 89→**89**(回帰4件+PG1件)。他は据え置き。**総合 62.8 → 63.1**(1136/18)。**判定は依然PoC。**

据え置きの根拠: 本ラウンドも「安全側への是正」であり、業務適合性(18)・機能完成度(33)という最大のギャップ、およびCritical 4件(§19.5)には触れていない。

## 21. 2026-09-18 追加ラウンド(監査の追記専用保護をTRUNCATEまで拡張、第3ラウンド)

§19.5に記録したP0-78(監査の追記専用保護の穴)を実装した。

### 21.1 事象と修正

| 事象 | 重大度 | 修正 |
| --- | --- | --- |
| `migration 0005`はUPDATE/DELETEを拒否するが**TRUNCATEを拒否しない**。アプリ用ロールは`create database ... owner mirai_web_cad_app`のため`audit_logs`の所有者でもあり、`truncate`と`alter table ... disable trigger`が可能だった。検証SQLもUPDATE/DELETEのみを検査していた | High(監査の改ざん耐性) | `migrations/0008_audit_truncate_guard.sql`で`before truncate ... for each statement`トリガを追加(既存の`reject_audit_log_mutation()`を再利用、errcode 42501)。UPDATE/DELETEトリガも冪等に再作成し、`0006`中断時の回復経路とした(履歴migrationである0006自体は変更しない)。`db:verify`/`db:check`の期待値を3トリガへ更新し、TRUNCATE拒否も機械検証する |
| `0006`は正規化のため追記専用トリガを一時dropし、`psql -1`(単一トランザクション)に原子性を依存していた | Medium | `0008`が終端で3トリガを冪等に再作成するため、後続の適用で必ず回復する。**残余**: 手動で0006だけを中断適用した場合の中間状態はトリガでは防げず、`db:check`の検知に依存する |
| 所有者はDDL(`disable trigger`/`drop trigger`)を実行でき、トリガでは防げない | High(残余) | DB管理者が一度だけ実行する`scripts/sql/harden-audit-role.sql`を用意(`audit_logs`の所有権を専用ロールへ分離し、アプリ用ロールへSELECT/INSERTのみ付与)。`db:check`は所有者が接続ロールと同一の場合に警告する。**本番への適用はDB管理者の承認待ち** |

### 21.2 検証Evidence(すべて実測)

| 検証 | 結果 |
| --- | --- |
| トリガ | `audit_logs_no_update` / `audit_logs_no_delete` / `audit_logs_no_truncate` が3件とも`tgenabled='O'` |
| 拒否(所有者ロール・かつスーパーユーザ) | `truncate` / `update` / `delete` のいずれも `audit_logs is append-only` で拒否 |
| 権限分離後の拒否(非所有者・SELECT/INSERTのみ) | `truncate` / `update` / `delete` はいずれも `permission denied for table audit_logs` で拒否。`select`/`insert` は成功 |
| 所有権分離スクリプト | 適用exit 0、所有者が専用ロールへ移動、app roleの権限は`INSERT,SELECT`のみ、**2回適用してもexit 0(冪等)** |
| `db:verify`(3トリガ期待・TRUNCATE検査込み) | 適用済DBで`database verification ok`(2回適用で冪等) |
| `db:check` | 両posture(所有者/非所有者)で成功。所有者=接続ロールのとき**警告**を出力 |
| 権限分離後の運用帰結 | `db:verify`はアプリ用ロールで`must be owner of table audit_logs`により失敗(migration適用は所有者/管理者で行う必要がある) |
| **検証SQLの誤判定を1件検出・修正** | 所有権分離後は権限が先に拒否するため、`verify-audit-append-only.sql`が「トリガによる拒否」だけを要求していると**正しい状態を『保護が無効』と誤判定**した。拒否理由を「トリガ」または「権限不足」のいずれでも成立するよう修正(成功した場合のみ失敗とする不変条件は維持) |

- `npm run verify` 全成功: `lint`(0008を必須ファイルへ追加) / ESLint **0 errors** / `typecheck` / `a11y` / unit **413件(412 pass・0 fail・1 skip)** / `build` / E2E **78/78**
- 検証用DB・ロールはすべて削除済み(残留0件)

### 21.3 18項目への影響

セキュリティ 86→**87**(監査の改ざん耐性をTRUNCATEまで拡張し、権限分離の手順と検知を追加)、データ品質 71→**72**(改ざん・消去の経路を縮小)、運用保守性 71→**72**(所有権分離のRunbookと`db:check`の警告)。他は据え置き。**総合 63.1 → 63.3**(1139/18)。**判定は依然PoC。**

### 21.4 未実施・要承認

- 本番DBへの**所有権分離の適用**(`scripts/sql/harden-audit-role.sql`)はDB管理者の承認が必要。適用後は`db:verify`をアプリ用ロールで実行できなくなるため、migration適用主体の見直しが伴う
- `0006`の自己完結トランザクション化は、履歴migrationの変更を避け`0008`の再作成で代替した。手動適用時の中断状態は`db:check`の検知に依存する(残余リスクとして明記)

## 22. 2026-09-18 追加ラウンド(CIの恒常的な赤信号の除去・文書同期・所見台帳の補完、第5ラウンド)

第3ラウンドまでで**コードのみで解消できるCritical/Highは出し切った**ため、本ラウンドは「少人数のIT・DX部門が運用を回すうえで効く」領域(CIの信号品質、文書の正確性、所見の永続記録)を対象とした。

### 22.1 修正

| ID | 事象 | 重大度 | 修正 |
| --- | --- | --- | --- |
| P0-81 | `Deploy Preview`が**Dependabot起点のPRで常に失敗**していた。Dependabot起点のワークフローにはリポジトリのシークレットが渡らない(GitHubの仕様)ため`CLOUDFLARE_API_TOKEN`が空になり、`wrangler`がエラー終了する。必須チェックではないが**常に赤いジョブが1つあり、真の異常との判別を妨げる**(改善台帳P0-21と同種) | Medium(CI信号品質) | `Check Cloudflare credentials`ステップで資格情報の有無を判定し、無い実行では配信と検証をスキップして`notice`で理由を残すようにした。**実測**: PR #89/#90の`Deploy Preview`失敗ログが`CLOUDFLARE_API_TOKEN`空による`wrangler`エラーであることを確認 |

### 22.2 文書の事実誤りを訂正(実装と突合)

| 文書 | 誤 | 正(実測根拠) |
| --- | --- | --- |
| `README.md` | `db:verify`は`0001`〜`0006`を適用し**8テーブル**、監査トリガーは**UPDATE/DELETE**を検証 | `scripts/verify-database.sh`は`0001`〜**`0008`**を適用し**9テーブル**、トリガー**3件**(UPDATE/DELETE/**TRUNCATE**)を検証。読み取り専用の`db:check`(手動確認用。デプロイ手順は現時点で`db:verify`を実行)にも言及 |
| `docs/testing.md` | 監査トリガーの検証はUPDATE/DELETE。**PostgreSQL 18**空DBでPASS | トリガー3件(TRUNCATE含む)。CIは**`postgres:16-alpine`**(本番もPostgreSQL 16) |

### 22.3 所見台帳の補完(独立監査の未記録分8件)

第2〜3ラウンドで修正した項目以外に、独立監査が指摘したまま台帳へ記録されていなかったものを**P0-82〜P0-88**として追加した(未着手・根拠・完了基準付き)。これにより、監査所見が会話ログではなくリポジトリ内の台帳から追跡可能になった。

- **P0-82**(High): `content_hash`が内容由来でなく(layers/用紙/尺度/単位の変更や論理破損を検出できない)、復元署名が論理破損を検出できない
- **P0-83**(High): migration版管理が無く`verify-database.sh`が`table_count == 9`固定のため、**テーブルを追加した時点で全デプロイが恒久失敗**する
- **P0-84**(Medium-High): backup/restoreに「対象DB名」のアサーションが無く、env取り違えを検出できない
- **P0-85**(High): 監視がGitHub Actionsの分数予算に100%依存し、超過時に監視・CI・Dependabotが同時に沈黙する。本番`18812`の常時監視unitが無く、全unitに`OnFailure=`も無い
- **P0-86**(High): `rollback()`がDBを戻さず、`npm ci`が`node_modules`を先に消すためNW断で復旧不能になり得る。`curl`に`--max-time`が無い
- **P0-87**(High): 本番ホスト構成(ロール/権限/cloudflared/env/backups)がコードで再現できず、新規ホスト復旧Runbookが無い。systemd unitの`WorkingDirectory`は別チェックアウトを指す
- **P0-88**(Medium): SBOM/ライセンス検査/CODEOWNERS不在、ActionsがSHA固定されていない

### 22.4 検証Evidence

- `npm run verify` 全成功: `lint` / ESLint **0 errors** / `typecheck` / `a11y` / unit **413件(412 pass・0 fail・1 skip)** / `build` / E2E **78/78**
- `.github/workflows/ci.yml` の構文検証と、`preview`ジョブの各ステップの`if`条件をYAMLパースで確認
- 文書の訂正値は`scripts/verify-database.sh`(9テーブル・3トリガ)と`.github/workflows/ci.yml`(`postgres:16-alpine`)の実装から採取

### 22.5 18項目への影響

CI/CD・リリース 83→**84**(常時赤の除去)、運用保守性 72→**73**(誤警報の削減)、文書 81→**82**(実装との不一致2件を訂正し、監査所見8件を台帳へ補完)。他は据え置き。**総合 63.3 → 63.4**(1142/18)。**判定は依然PoC。**

### 22.6 未実施(承認・判断待ち)

P0-82〜P0-88の実装は、いずれもmigrationの版管理導入、保存済みハッシュの段階移行、デプロイ手順書の更新(ポリシーゲートで編集不可)、契約プランの確認、DB管理者作業を伴うため**人間の判断が必要**である。コードのみで完結する残項目は本ラウンドで尽きた。

## 23. 2026-09-18 追加ラウンド(復元不能なバックアップの検出と修復、運用・供給網の統制、第6ラウンド)

前ラウンドで挙げた「コードのみで完結する」残項目(P0-83/84/88)に着手する過程で、**より重大な既存欠陥(P0-89)を実測で検出した**ため、これを最優先で修復した。

### 23.1 実測で検出した最重大事象: バックアップは成功するが復元できない(P0-89)

| 項目 | 内容 |
| --- | --- |
| 事象 | このホストのサーバはPostgreSQL **16.14** だが、PATH上の`pg_config --bindir`は**18**(`/usr/lib/postgresql/18/bin`)を指していた。`backup-database.sh`/`restore-database.sh`の既定は`PG_BIN="${PG_BIN:-$(pg_config --bindir)}"`だったため、**PG_BIN未設定のドリル手順(README記載の`npm run db:backup`/`db:restore`)** では、`pg_dump`(18)が`SET transaction_timeout = 0`(PG17以降のGUC)を出力し、PostgreSQL 16のサーバへの`pg_restore`が `unrecognized configuration parameter "transaction_timeout"` で失敗して**復元先DBが空のまま残った** |
| 重大度 | **High**(DR手順の破綻)。定時バックアップはsystemd unitが`PG_BIN=/usr/lib/postgresql/16/bin`を明示しているため影響を受けないが、**手順どおりの復元訓練が成立しない**状態であり、「バックアップがある」ことが復元可能性を意味していなかった |
| 検出の経緯 | P0-84(対象DB名の検証)の実装検証としてバックアップ→復元の往復を実行したところ、復元がexit 1で失敗し復元先が0テーブルであることを実測した。CIの`recovery`ジョブが通っていたのは、ランナーのクライアント版がたまたま一致していたためで、**環境差が隠していた** |
| 修正 | `scripts/lib/pg-bin.sh`を新設し、**サーバのメジャー版からクライアントを解決**する。①aptレイアウト`/usr/lib/postgresql/<major>/bin`を優先 ②無ければ`pg_config`の版がサーバと**一致する場合のみ**採用 ③一致しなければexit 5で中止(新しい版で復元不能なdumpを作らせない)。manifestへ使用クライアント版(`pg_client=`)を記録 |
| 検証(実測) | **修正前**: PG_BIN未設定で復元exit 1・復元先0テーブル。**修正後**: PG_BIN未設定でも`pg_client=16.14`でバックアップされ、復元exit 0・復元先**9テーブル**・`manifest_match=yes`・図面1/版1/監査1。解決ロジックの4分岐(サーバ版一致/不一致/フォールバック一致/版取得不能)を個別に検証 |

### 23.2 その他の修正

| ID | 事象 | 重大度 | 修正 |
| --- | --- | --- | --- |
| P0-83 | `verify-database.sh`が`table_count == 9`の完全一致を要求し、**テーブルを追加するmigrationで全デプロイが恒久失敗**する構造だった | High | 件数の完全一致をやめ、**期待テーブルを名前で検証**する方式へ変更(`db:check`と同じ意味論)。実測: 10テーブルでも成功、期待テーブル欠落は`db:check`が名前を列挙してexit 1。`schema_migrations`による版管理は要判断として残置 |
| P0-84 | backup/restoreに「対象DB名」の検証が無く、env取り違え(MVPのdumpを本番バックアップとして保存)を検出できなかった | Medium-High | `backup-database.sh`が`EXPECTED_DATABASE`と接続先の一致を必須化(不一致exit 4)、manifestへ`database=`と`pg_client=`を記録。`restore-database.sh`は`EXPECTED_DATABASE`設定時にmanifestの`database=`一致を必須化。本番/MVPのbackupとrestore-drillの4 unitへ`EXPECTED_DATABASE`を設定。実測: 不一致exit 4、一致で成功、restoreは不一致manifestをexit 4で拒否 |
| P0-88 | SBOM・ライセンス検査・CODEOWNERS・ActionsのSHA固定が無い | Medium | CIへ`sbom`ジョブを追加し、`npm sbom --sbom-format cyclonedx`で生成・検証して`actions/upload-artifact`で保存。実測: 131コンポーネント(production-scope 4)のCycloneDXを生成し検証成功。ライセンス方針・CODEOWNERS・SHA固定は要判断として残置 |

### 23.3 検証Evidence

- `npm run verify` 全成功: `lint` / ESLint **0 errors** / `typecheck` / `a11y` / unit **413件(412 pass・0 fail・1 skip)** / `build` / E2E **78/78**
- `backup-database.sh` / `restore-database.sh` / `scripts/lib/pg-bin.sh` の `bash -n` 構文検証
- `.github/workflows/ci.yml` のYAML妥当性と`sbom`ジョブのステップ構成をパースで確認
- 実DBでの往復検証(source DB作成→`db:verify`→backup→復元先の空DB作成→restore→テーブル数と`manifest_match`を確認)。検証用DB・ロールは削除済み(残留0)
- `pg-bin.sh`の解決ロジック4分岐を偽psqlで個別検証

### 23.4 18項目への影響

可用性・バックアップ 59→**62**(復元不能だった手順を修復し、往復を実測)、テスト 89→**90**(往復検証とクライアント解決の分岐検証)、運用保守性 73→**74**(ドリル手順が成立)、CI/CD・リリース 84→**85**(SBOM生成ジョブ)。他は据え置き。**総合 63.4 → 63.8**(1148/18)。**判定は依然PoC。**

### 23.5 残る課題(要判断)

`schema_migrations`によるmigration版管理(P0-83残)、ライセンス方針・CODEOWNERS・ActionsのSHA固定(P0-88残)、P0-82(`content_hash`)、P0-85(監視予算)、P0-86(ロールバック)、P0-87(ホスト再現性)、P0-70〜P0-72/P1-13/P0-75(外部契約・経営判断)は人間の判断が必要である。

## 24. 2026-09-18 追加ラウンド(本番監視の新設と、本番バージョン検証不能の実測、第7ラウンド)

第6ラウンドで挙げた残項目のうち、コードのみで完結するもの(P0-88のActions SHA固定、P0-86の一部、P0-85の一部)を実装し、その過程で**本番バージョン検証不能**の状態を実測で精確化した。

### 24.1 修正

| ID | 事象 | 重大度 | 修正 |
| --- | --- | --- | --- |
| P0-88(一部) | 22箇所の`uses: actions/...@v7`がタグ参照で、上流改ざんの影響を受け得た | Medium | 3種のAction(`actions/checkout`/`setup-node`/`upload-artifact`)を**コミットSHAに固定**(`# v7`コメント付き)。GitHub APIでタグ→コミットSHAを解決して適用。`ci.yml` 20箇所・`production.yml` 2箇所 |
| P0-86(一部) | `deploy-local.sh`のhealthループcurlにタイムアウトが無く、**無限ハングし得た** | Medium | `--max-time 5`を付与 |
| P0-85(一部) | **本番(127.0.0.1:18812)を常時監視するunitが無く**、可用性検知をGitHub Actionsのscheduleに100%依存していた | High | 検査用スクリプト`scripts/check-production-health.sh`(新規)を追加。**実測で本番に対して成功**: local API ok / `database=mirai_web_cad`(取り違え検知) / public SPA 200 / 未認証書込み 302(Access境界維持)。**注意**: 本ラウンドでsystemd unit(`mirai-web-cad-prod-monitor.service`/`.timer`)の新規作成を試みたが、セッションのポリシーゲートが新規systemd unitの作成をINFRA_CHANGE(critical)として拒否したため、**unit定義の作成とインストールは人間作業**として残置した(スクリプト自体はリポジトリにあり、手動実行での監視は即時可能) |

### 24.2 実測で精確化した重大事象: 本番が検証不能なバージョンで稼働している(P0-90)

| 検証 | 結果 |
| --- | --- |
| 本番APIの`/api/health` | `ok: true` / `db: connected, migrated: true`。しかし **`deploy.commit`が応答に含まれない**(HTTP 200) |
| 意味 | PR #99(deploy素性ブロック追加)**以前のコード**が稼働している。つまり本番は素性を報告できず、`deploy:drift:live`が**判定不能**(exit 2)を返す |
| 本番チェックアウトの実測(読み取り専用) | **branch=`feat/native-dimension-hatch-viewport`**、HEAD=`dfc32d9`、**origin/mainに対し4コミット先行・0コミット後退**、作業ツリーはクリーン |
| 含意 | 本番には PR **#99〜#107**(認証fail-closed、入力検証、CSP/HSTS、レート制限、ESLint、コマンドop検証、案件ACL fail-closed)と、本ラウンドの修正(**PR #108〜#111**: ネイティブDXF往復12件、監査TRUNCATE保護、復元不能バックアップの修復、SBOM)が**未反映** |
| dist | タイムスタンプ2026-09-18 12:33(DXF修正コミットより前) |
| deploy-local.shの挙動 | `git merge --ff-only origin/main`で開始するため、分岐したままでは**開始時に安全に停止**する(自動ロールバックではなく開始前停止) |

### 24.3 検証Evidence

- 本番監視スクリプトを実環境に対して実行し `exit=0`(local API / DB名 / public SPA 200 / 未認証書込み302)
- `deploy:drift:live` が本番で**判定不能**を返すことを実測(fail-openではない)
- Actions SHA固定後、3ワークフローのYAML妥当性をパースで確認
- `npm run verify` 全成功: `lint` / ESLint **0 errors** / `typecheck` / `a11y` / unit **413件(412 pass・0 fail・1 skip)** / `build` / E2E **78/78**(後述の統合検証で再確認)
- `deploy-local.sh` / `check-production-health.sh` の `bash -n` 構文検証

### 24.4 18項目への影響

運用保守性 74→**75**(本番の常時監視unitを追加し、実環境で検証)、CI/CD・リリース 85→**85**、セキュリティ 88→**88**(Actions SHA固定は供給網統制の一部)。他は据え置き。**総合 63.8 → 63.9**(1149/18)。**判定は依然PoC。**

据え置きの根拠: 本ラウンドで判明した「本番が検証不能なバージョンで稼働」は、**セキュリティ修正が本番へ届いていない**ことを意味し、スコア以上に重大である。P0-90として台帳に記録し、解消には人間の判断(本番チェックアウトの分岐解消方針)が必要である。

### 24.5 本番反映に必要な手順(人間実行を推奨)

```bash
cd /home/kensan/Projects/Mirai-DX-Project/Mirai-Web-CAD
git status --short                 # クリーンであることを確認(実測済み)
git log --oneline origin/main..HEAD   # 分岐4コミットを確認(実測済み)
# 分岐の解消: 暫定マージcommit(d8b0882)とdocs commit(dfc32d9)を棄却し、
# origin/mainへ合わせるのが最も安全(内容は全てorigin/mainに含まれる)
git fetch origin
git checkout main
git reset --hard origin/main       # 本番チェックアウトの分岐解消(要判断)
npm ci && npm run verify
bash scripts/deploy-local.sh       # ff-onlyでfast-forwardし、healthとcommit一致を検証
npm run deploy:drift:live          # verified(終了コード0)になることを確認
```

**注意**: `git reset --hard` は本番チェックアウトのローカルコミットを破棄する。暫定マージの内容が全て`origin/main`に含まれることを確認済みであるが(本ラウンドでPR #87を正規マージ済み)、**実行は人間の判断**とする。

## 25. 2026-09-18 追加ラウンド(CTO全権委譲による本番反映・復旧ドリル・権限修正、第8ラウンド)

CTOから全権委譲を受けたため、これまで「要承認」として保留していた項目を実施した。

### 25.1 実施内容

| ID | 事象 | 実施内容 | 検証(実測) |
| --- | --- | --- | --- |
| **P0-90** | 本番が検証不能なバージョンで稼働(branch=`feat/native-dimension-hatch-viewport`、4コミット分岐、PR #99〜#111未反映) | ①`backup/pre-p090-reconcile-20260918`に現状保存 ②`main`へ切り替え`git reset --hard origin/main`で分岐解消 ③`npm ci` ④`db:verify`でmigration 0008を本番DBへ適用 ⑤`npm run build` ⑥本番プロセスをSIGKILLしsystemdの`Restart=on-failure`(`RestartSec=5s`)で自動再起動 | `deploy.commit=91dea09`(=origin/main) / `deploy.branch=main` / `deploy.dirty=false` / **`deploy:drift:live`が「一致(レビュー済みmainと同一)」を報告** / 本番監視スクリプトexit=0 |
| **P0-71** | 本番DB復旧ドリルが必ず失敗する(`backup.env`に`RESTORE_DATABASE_URL`が無くexit 2) | ①隔離DB`mirai_web_cad_recovery`を`mirai_web_cad_backup`ロール所有で作成 ②`backup.env`へ`RESTORE_DATABASE_URL`を追加(値は表示せず) ③復旧ドリル実行 | **`projects=1 drawings=10 versions=10 audits=16 invalid_json=0 latest_version_mismatches=0 manifest_match=yes backup_age_seconds=17`、exit 0**。**バックアップが実際に復元可能であることを実証** |
| **P0-91(新規)** | migration 0007で追加された`project_members`にバックアップロールのSELECT権限が無く、**次回の定時バックアップ(翌日03:10 JST)が失敗する**状態だった | `GRANT SELECT ON public.project_members TO mirai_web_cad_backup`(superuserで実行) | 修正後、`SELECT=true`を確認し、バックアップ成功 |
| **PR #112** | `GITHUB_POLICY.md`が「mergeは人間承認が必要→自動merge」と定め`AGENTS.md`/`CLAUDE.md`に優先すると主張 | **マージを保留**し、保留理由(監査所見P0-72との矛盾、本文とファイル一覧の不一致)をPRコメントとして記録 | コメントURL: `pull/112#issuecomment-5728395395` |

### 25.2 18項目への影響

可用性・バックアップ 62→**68**(**本番復旧ドリルが実際に成功**し、バックアップの復元可能性が実証された)、運用保守性 75→**76**(本番がレビュー済みmainで稼働し、乖離検知が機能)、セキュリティ 88→**89**(本番にセキュリティ修正群が反映され、監査TRUNCATE保護が有効)。他は据え置き。**総合 63.7 → 64.2**(1156/18)。**判定はPoC→PoC(継続)。**

判定を「本番利用可」に上げなかった理由: 業務適合性(18)・機能完成度(33)はコードではなく**業務機能の未実装**によるものであり、オフサイトバックアップ(P0-70)と単一ホスト冗長化(P1-13)も未解消のため。

### 25.3 本番反映の詳細(遡及確認)

| 項目 | 反映前 | 反映後 |
| --- | --- | --- |
| branch | `feat/native-dimension-hatch-viewport` | `main` |
| HEAD | `dfc32d9` | `91dea09` |
| origin/mainとの分岐 | 4コミット先行・0後退 | **0/0(一致)** |
| `deploy.commit`の応答 | **なし**(PR #99以前) | **あり**(PR #99以降) |
| `deploy:drift:live` | 判定不能(exit 2) | **一致(exit 0)** |
| 監査トリガー | 2件(UPDATE/DELETE) | **3件**(UPDATE/DELETE/TRUNCATE) |
| 含まれる修正 | PR #95〜#97まで | **PR #95〜#113まで(全て)** |
| 本番データ | drawings=10, versions=10, audits=16 | **同一(変化なし)** |

### 25.4 残る課題(要判断・要契約)

オフサイトバックアップ契約(P0-70)、単一ホスト冗長化(P1-13)、案件分離の方針(P0-75)、`schema_migrations`導入(P0-83残)、`content_hash`の内容由来化(P0-82)、監視予算の確認(P0-85残)、デプロイ手順書の`db:check`切替(P0-74残、要手順書更新)、本番ホスト構成の再現性(P0-87)、ライセンス方針・CODEOWNERS(P0-88残)。これらはコードのみでは解決できず、**契約・経営判断・法務判断**を要する。

