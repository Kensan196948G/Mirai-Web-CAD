# 本番運用適合性評価書

評価日: 2026-08-30(前回 2026-08-29)
対象: Mirai Web CAD 0.1.0  
前提: 従業員約600名、IT・DX部門7名、公共工事80%、民間工事20%

## 1. 結論

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

Cloudflare Pagesは`_headers`で静的応答のCSP等を設定できるがFunctions応答には適用されないため、API側にも直接付与した。[Cloudflare公式](https://developers.cloudflare.com/pages/configuration/headers/)。2026-08-30の移行後は`scripts/serve-production.mjs`が`_headers`を読み込んで全応答へ適用しており、この制約自体が解消している。

(2026-08-30以前の記録)Neonの履歴保持は復旧窓に依存し、保護branchは削除/reset/compute削除を防ぐ。履歴は1日のため、本番基準の7-35日へ延長するにはプラン・費用・RPO合意が必要だった。[Neon restore window](https://neon.com/docs/manage/projects) / [Protected branches](https://neon.com/docs/guides/protected-branches)。2026-08-30にNeon依存自体を除去したため、この制約は対象外になった。ローカルPostgreSQLのRPO/RTOは`docs/deployment-local.md`・`docs/operations.md`の「Backup / Restore」節を参照。
