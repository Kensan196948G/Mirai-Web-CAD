# 本番運用適合性評価書

評価日: 2026-08-26  
対象: Mirai Web CAD 0.1.0  
前提: 従業員約600名、IT・DX部門7名、公共工事80%、民間工事20%

## 1. 結論

- 改善前判定: **PoC**、総合 41.5/100、競合代替率 27%
- 本ラウンド改善後: **PoC**、総合 48.3/100、競合代替率 32%
- 本番導入可否: 公開デモ閲覧と限定的な検証利用は可。本番図面の正本、施工成果物作成、協力会社との共有には不可
- 投資判断: **条件付き継続**。DWG往復、寸法・レイアウト・PDF、案件単位RBAC、SSO再構成、バックアップ自動化をPhase 1の継続条件とする

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
| DB | Neon PostgreSQL。Preview/Production分離、Migration 0001-0004適用済み |
| テスト | Unit/API 33件、Playwright E2E、axe、型検査、Lint、空DB Migration、復旧ドリル |
| 未確認 | OpenDesign正本、GitHub Issue/PRの全過去議論、実ユーザー受入、契約・法務、DWG実案件互換、負荷100k/1m図形、RTO実測 |

主なコード証拠は`src/cad-core.js`、`src/api-handler.js`、`src/data-store.js`、`tests/`、`migrations/`、`.github/workflows/mirai-web-cad*.yml`。要求根拠はリポジトリ内の要件定義書・詳細仕様設計書を用いた。

## 3. 18項目評価

| 評価軸 | 改善前 | 改善後 | 根拠と残差 |
| --- | ---: | ---: | --- |
| 業務適合性 | 32 | 34 | 土木デモ、数量、レビューあり。案件、工種、成果品、発注者様式なし |
| 機能完成度 | 24 | 25 | 基本図形と編集の一部。寸法、ハッチ、ブロック、外部参照、レイアウト、DWG/PDFなし |
| UI/UX | 48 | 52 | CAD配置とCLIあり。公開閲覧の権限表示を固定。大量操作・プロパティ編集は不足 |
| アクセシビリティ | 70 | 71 | axe、キーボード、モバイルE2Eあり。Canvas図形の代替表現は不足 |
| データ品質 | 38 | 44 | schema検証、重複ID検査、hash、明示的公開属性。座標系・単位変換・系譜監視なし |
| AI有効性 | 22 | 22 | 人間承認と差分あり。外部AI/RAGではなく、土木判断を支援する根拠データなし |
| 設計 | 45 | 51 | コマンドモデル、API/Store分離。更新原子化を追加。案件境界と非同期処理なし |
| コード品質 | 68 | 74 | 小規模で型検査・Lintあり。巨大な単一UIモジュールとJSDoc型が残る |
| 性能・拡張性 | 18 | 21 | Canvas単一描画、ページングなし。要求の100k図形/30fpsは未証明 |
| セキュリティ | 42 | 58 | JWT fail-closed、RBAC、CSP、サイズ制限、公開属性、CORS限定。案件RBAC・WAF・SIEMなし |
| 可用性・バックアップ | 20 | 38 | 復旧スクリプトと空DB復旧試験を追加。本番自動バックアップ/RTO試験なし |
| 監視・障害対応 | 18 | 30 | request ID、5xxログ、公開health。アラート、SLO、当番、合成監視なし |
| テスト | 67 | 73 | 33 Unit/API、12 E2E、実Neon原子更新確認。性能・権限マトリクス・障害注入不足 |
| CI/CD・リリース | 72 | 79 | Gate、Migration、Gitleaks、復旧Job、Preview/Production。手動承認保護なし |
| 運用保守性 | 32 | 49 | runbook、復旧手順、改善台帳を追加。600名運用の管理UIと一次窓口なし |
| 文書 | 65 | 74 | README/API/試験/運用/評価を更新。利用者手順とデータ辞書は不足 |
| 費用対効果 | 48 | 54 | 小規模Web構成は安価。CADエンジン再実装コストが高く、当面は併用が合理的 |
| 競合代替性 | 18 | 21 | 基本作図のみ。DWG忠実性、印刷、API拡張、オフライン、サポートで大差 |
| **総合** | **41.5** | **48.3** | **PoC** |

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
17. Neon mainをprotectedにし、branch/project/computeの誤削除とresetを防止した。

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
| 重大 | DWG入出力がない | 既存図面の忠実な往復ができず、成果物正本にできない |
| 重大 | 永続編集用SSO経路がない | Access Application削除済みのため、Productionは匿名閲覧のみ |
| 重大 | 案件/図面単位RBACがない | Access利用者はIDを知れば任意図面を取得し得る。project_idも固定 |
| 重大 | 本番バックアップ自動化・本番復元試験なし | 現在のNeon履歴保持は1日。RPO/RTO未合意 |
| 高 | 寸法、ハッチ、ブロック、外部参照、レイアウト、PDFがない | 日常2D CADフローが完結しない |
| 高 | 100k図形/30fps要件が未達・未計測 | 単一Canvas全件描画で大図面停止の可能性 |
| 高 | Neon projectが他用途と共用 | Project管理権限と障害のblast radiusがCAD専用に分離されていない |
| 高 | DBが米国リージョン | 公共工事・個人情報のデータ所在判断が未確認 |
| 高 | LocalStorageが平文 | ローカル作業図面が端末利用者・スクリプトから読める |
| 高 | 監査ログが追記専用としてDB権限分離されていない | DB権限保有者による改変を抑止できない |
| 高 | 自動監視と通知がない | 障害発見が利用者申告依存になる |
| 高 | Production GitHub Environmentに承認保護がない | base branch pushで自動本番Deployされる |
| 中 | AI計画作成と監査記録は別コミット | 監査欠落の可能性が残る。図面変更は原子化済み |
| 中 | CORS許可先が単一Custom Domain | Pages標準URLをクロスオリジンAPIとして使う構成には追加設定が必要 |
| 中 | APIレート制限/WAFルール未設定 | 公開health/demoへの濫用耐性はCloudflare既定のみ |
| 中 | マルウェア検査がない | 将来バイナリ/DWGアップロード前に必須 |
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

| 区分 | 重み | 改善前カバー | 改善後カバー | 改善後寄与 |
| --- | ---: | ---: | ---: | ---: |
| 主要業務フロー | 35% | 25% | 28% | 9.8 |
| 必須機能 | 25% | 20% | 22% | 5.5 |
| UX | 15% | 45% | 50% | 7.5 |
| データ連携 | 10% | 10% | 12% | 1.2 |
| セキュリティ・監査 | 10% | 35% | 52% | 5.2 |
| 運用保守性 | 5% | 30% | 48% | 2.4 |
| **加重合計** | **100%** | **27%** | **32%** | **31.6** |

80%到達の必須条件は、DWG/DXF往復互換、寸法/ハッチ/block/layout/PDF、案件管理、Entra ID SSO/MFA、図面単位RBAC、監査保全、7日以上の復旧、性能基準、オフライン閲覧、操作手順とUATである。90%には外部参照、Sheet Set、LISP/API互換、地理座標、BIM連携、管理配布、24時間監視、実案件100本以上の互換認定が加わる。

意図的に代替しない候補は、高度3D/BIM authoring、レンダリング、機械/電気専用CAD、汎用LISP完全互換、法定電子納品チェッカー本体である。既存製品・公的ツールとの連携を優先する。

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

- Phase 0 重大問題・セキュリティ: 公開/更新境界、原子更新、CSP、復旧ドリルは実装。SSO再構成、案件RBAC、branch保護、監視を残す。
- Phase 1 中核業務完成: DWG/DXF往復、寸法、ハッチ、block、layout/PDF、案件/図面一覧、版比較、UAT。
- Phase 2 80%代替: 100k図形性能、offline PWA、M365/SharePoint、協力会社共有、電子納品、運用SLO。
- Phase 3 AI・モバイル・外部連携: ACL付きRAG、属性抽出、異常候補、mobile markup、公開API/webhook。
- Phase 4 90%代替・最適化: 外部参照/Sheet Set、GIS/BIM、互換認定、DR演習、利用分析、契約最適化。

## 10. 外部基盤の判断

Cloudflare Pagesは`_headers`で静的応答のCSP等を設定できるがFunctions応答には適用されないため、API側にも直接付与した。[Cloudflare公式](https://developers.cloudflare.com/pages/configuration/headers/)

Neonの履歴保持は復旧窓に依存し、保護branchは削除/reset/compute削除を防ぐ。本ラウンドでmainをprotectedにしたが、履歴は1日のため、本番基準の7-35日へ延長するにはプラン・費用・RPO合意が必要である。[Neon restore window](https://neon.com/docs/manage/projects) / [Protected branches](https://neon.com/docs/guides/protected-branches)
