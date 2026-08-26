# 改善台帳

更新日: 2026-08-26。工数は1人日=実働8時間の概算であり、調達・契約・UAT待ちは含めない。

## 今すぐ

| ID | 内容 | 理由/対象 | 効果 | 難易度・工数 | 優先度 | 依存/リスク | 完了基準 | 状態 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| P0-01 | 匿名閲覧と更新認証を分離 | 全利用者/権限逸脱防止 | 公開性と機密性を両立 | 中 3日 | P0 | Access設計 | public図面のみ200、全write 401 | 完了 |
| P0-02 | DB更新の原子化 | CAD担当/データ不整合防止 | 図面・版・監査・冪等性を同時確定 | 高 4日 | P0 | Neon SQL | 障害時に部分更新なし | 完了 |
| P0-03 | CSP等の配信header | 全利用者/XSS・clickjack低減 | browser防御 | 低 1日 | P0 | CSP回帰 | Header実測、E2E成功 | 完了 |
| P0-04 | JSON 1 MiB/Content-Type/CORS制限 | 運用/濫用低減 | API資源保護 | 低 1日 | P0 | 大容量Import方式 | 413/415/CORS test | 完了 |
| P0-05 | backup/restore drill | 運用/消失対策 | 手順の機械検証 | 中 2日 | P0 | PG client | 空DB復元と件数検証 | 完了 |
| P0-06 | Entra ID + Cloudflare Access再構成 | 社員/永続編集 | SSO/MFA/RBAC | 中 3-5日 | P0 | IdP管理者、HENNGE方針 | 社員3roleでE2E | 未着手 |
| P0-07 | Neon main保護・復旧窓延長 | 運用/誤削除防止 | RPO改善 | 低 1日 | P0 | 復旧窓の費用承認 | protected、7日以上、復旧演習 | 一部完了: protected |
| P0-08 | Production環境承認Gate | CTO/誤deploy防止 | 変更統制 | 低 1日 | P0 | GitHub権限 | reviewer必須、rollback確認 | 未着手 |
| P0-09 | 合成監視・通知 | IT/DX 7名 | 発見時間短縮 | 中 2日 | P0 | 通知先 | 5分監視、health/demo/write境界alert | 未着手 |

## 3か月以内

| ID | 内容 | 対象/効果 | 難易度・工数 | 優先度 | 依存/リスク | 完了基準 |
| --- | --- | --- | --- | --- | --- | --- |
| P1-01 | 案件/組織/図面ACL | 全利用者/最小権限 | 高 15日 | P0 | Entra group、DB設計 | 横断IDOR test、監査、管理手順 |
| P1-02 | 案件・図面一覧/検索 | 現場・本社/主要flow | 中 10日 | P1 | P1-01 | empty/error/page test、1万件検索 |
| P1-03 | DWG/DXF round-trip engine選定 | CAD担当/正本互換 | 高 20-40日 | P0 | SDK契約・license | 実案件100図面の許容差合格 |
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
| P2-01 | 100k図形描画/空間index/Web Worker | CAD担当/性能 | 高 30日 | P0 | kernel | p95入力100ms、30fps、長時間test |
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
