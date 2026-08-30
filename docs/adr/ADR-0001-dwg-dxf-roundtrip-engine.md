# ADR-0001: DWG/DXF round-trip engineの選定

## ステータス

提案中(Proposed) — 契約・実装着手には人間の承認が必要

## コンテキスト

改善台帳(`docs/improvement-register.md`)P1-03「DWG/DXF round-trip engine選定」は、優先度P0・工数20〜40日規模のタスクであり、依存として「SDK契約・license」、完了基準として「実案件100図面の許容差合格」を掲げている。関連して、P1-05(hatch/block属性)は「DWG model」に依存し、P1-06(layout/plot/PDF)は「font/plot style」に依存しており、いずれも本ADRの決定に連鎖する。

現状(`docs/operations.md`「既知制約」より)、対応範囲は限定的である。

- Mirai JSONとASCII DXFの2D Importのみ対応。DWG、DXF書出し、PDF、寸法、ブロック、ハッチは試作〜限定対応
- `docs/operations.md`には既に「OpenDesign外部正本へ接続する手段は現環境にないため、リポジトリ内仕様HTMLとの整合を正本として確認中」との記載があり、ODA(Open Design Alliance)との接続が過去に検討されたが未着手であることを示唆している

**現行実装の確認結果**(本ADR作成時点でリポジトリを調査):

| ファイル | 実装内容 | 備考 |
|---|---|---|
| `src/importers.js`(244行) | `dxf-parser`(npm, v1.1.2)でASCII DXFをパースしJSON正規化。拡張子判定、`DxfParser().parseSync()`呼び出しとentity正規化 | DXF**読込のみ**。DWGバイナリは非対応 |
| `package.json` | `"dxf-parser": "1.1.2"`が唯一のCAD形式ライブラリ依存 | DXF書出し・DWG読み書きのライブラリは未導入 |
| `src/cad-core.js`、`src/data-store.js`、`src/api-handler.js`、`src/app.js` | `"dwg_..."`という文字列は図面(drawing)のID接頭辞として内部利用されているのみ | **実際のDWGバイナリ形式サポートは存在しない**。命名上の紛らわしさに注意 |
| DXF書出し(export) | リポジトリ内に実装を確認できず | 未実装 |

つまり現状は「DXF(ASCII)の片方向Import」のみであり、round-trip(相互往復、DWG対応含む)には至っていない。この差を埋めるエンジン選定が本ADRの主題である。

DWG/DXFは土木・建設業界の正本フォーマットであり、AutoCAD系ツールとの相互運用性(特にDWGバイナリの完全往復)は、実案件を扱うCADシステムとして事実上必須の要件である。一方で、DWGバイナリ形式は仕様の大部分がAutodesk非公開であり、オープンソースでの完全再現は困難という業界共通の制約がある。

## 検討した選択肢

Web調査(2026年8月時点の公開情報)に基づく比較。**ライセンス費用は変動が大きく、契約時に必ず一次情報(ODA公式、Tech Soft 3D、Autodesk APS)で再確認すること。**

| 選択肢 | ライセンス費用(概算、要一次情報確認) | Web/Node.js適合性 | DWG完全対応度 | 実装工数への影響 | 主なリスク |
|---|---|---|---|---|---|
| ①ODA Drawings SDK(旧Teigha) | 年会費制。複数のWeb調査で金額に相違があり(調査元により Sustaining初年$11K前後、または$7,500前後など)、**いずれも未確認の二次情報**。区分(Non-Commercial/Commercial/Sustaining/Founding)ごとの対象権利・通貨・価格表版・確認日を含め、契約前に必ずODA公式(https://www.opendesign.com/pricing)で最新版を取得すること | C++ SDKのためNode.js/ブラウザから直接使えない。ネイティブアドオンまたはマイクロサービス化が必要 | 業界標準、DWG完全対応の実績が豊富 | 高(SDKバインディング開発・ビルド環境整備・保守が別途必要) | 非会員規約・監査条項あり。契約解除時のコード扱い、再配布制限を精査要。会費は継続コスト |
| ②Autodesk RealDWG | Autodeskとの直接契約(非公開)。手続きはTech Soft 3Dが代行 | 配布制限が極めて厳しく、通常はAutoCADベース製品への組込みのみ許諾。独立Web SPA構成には原則そぐわない | 純正実装のため最も確実 | 契約交渉自体に時間を要し、承認プロセスも重い | パートナー審査・用途制限があり、本プロジェクトの想定用途に適合しない可能性が高い。事実上の除外候補 |
| ③オープンソース(LibreDWG等) | 無償(GPLv3) | Node.jsからはネイティブバインディングかCLI呼び出しが必要。npm(`dxf-parser`等)はDXF ASCIIのみでDWGバイナリ非対応 | LibreDWG 0.13.4時点で**DWG読み込み**は約99%(r1.2〜2018対応)。**DWG書き込み**はR2004以降が実験的で、R2007は直接非対応(R2010へフォールバック)、他バージョンも他CADでCRC/audit失敗の可能性あり安定域とは言えない。**DXF書き出し**はR13〜R2021対応と幅広いが、対象バージョンごとの実測検証なしに安定と断定しない | 中(DXF書出しは比較的低コスト。DWG対応はLibreDWGの成熟度次第で工数増大) | GPLv3のためリンク方式次第で自社コードへのcopyleft波及リスク。要法務確認。DWG書き込みの完成度不足により完了基準未達の可能性 |
| ④クラウドAPI型(Autodesk Platform Services Model Derivative API) | 従量課金。旧Cloud Credit体系(1.5CC/変換等)は2025年12月のAPS価格体系刷新(Free/Paidの二層、Flex tokens)で置き換えられており**廃止済みの情報**。現行の処理対象別単価は公式(https://aps.autodesk.com/aps-sales)で要確認 | 自前実装不要。HTTPS API呼び出しのみで親和性が高い | Autodesk公式サービスのため高精度 | 低(薄いAPIクライアントのみ) | 図面データを外部SaaSへ送信する必要があり、公共工事図面等の機密保持・データ主権の観点で懸念。従量課金・外部依存の可用性リスク |
| ⑤ハイブリッド案(DXFを正本+ODA File Converter CLIでDWGブリッジ) | ODA File Converter自体は無償・会員登録不要で入手可能。**ただし非会員の利用は非商用の評価・参照用途に限定され、商用アプリケーションへの組込み・再配布は許諾されない**(ODA公式FAQ)。商用利用には別途ODA会員契約または明示的な許諾が必要 | CLIツールをNode.jsサーバーからサブプロセス起動する構成 | DWG↔DXF変換自体はODA製で高精度(R12〜2018対応)。ただし自社側のDXF round-trip完成度がボトルネック | 中(CLIラッパーは小さいが、自社側のDXF書出し実装が別途必要。P1-04/P1-05と一部重複) | **商用利用許諾が未取得の状態では採用不可**。取得後もSLA非保証・バッチCLIのプロセス管理設計が必要。DWGの完全ネイティブ往復ではない |

## 決定(推奨案)

**選択肢⑤「ハイブリッド案」を短期の実務解として推奨し、並行して選択肢①「ODA Drawings SDK正式契約」を中期(6〜12か月)の本命候補として並走評価する。ただし選択肢⑤は、ODA File Converterの商用利用について会員契約または明示的な許諾を取得することを実装着手の前提条件とする(非会員は非商用評価用途限定のため、許諾未取得のまま商用プロダクトへ組み込むことはできない)。** 選択肢②(RealDWG)は用途不適合のため除外、選択肢④(クラウドAPI)はデータ主権懸念により当面除外、選択肢③(LibreDWG単独)はDWG書き込みの完成度不足によりメインエンジンとしては非推奨とする。

### 理由

1. **会社規模と体制への現実性**: 7名規模のIT/DX部門というリソース制約下で、C++ SDKのネイティブバインディング開発・保守(選択肢①単独フルスクラッチ)をいきなり20〜40日で完成させるのは高リスク。まず無償のODA File ConverterでDWG⇔DXF変換のパイプラインを組み、自社のDXF round-trip(書出し含む)を先に完成度100図面許容差合格まで引き上げる方が、限られた工数で完了基準に到達しやすい。
2. **「DXFを正本」戦略との整合**: 現行実装(`src/importers.js`)は既にDXF ASCII Importという土台がある。DXFを正本形式とし、DWGは変換ブリッジ経由で扱う設計は既存資産の再利用性が高く、P1-04・P1-05・P1-06の各タスクとも自然に接続する。
3. **データ主権・機密保持の懸念回避**: 公共工事図面を扱う可能性のある土木・建設会社にとって、選択肢④への図面送信は契約・秘密保持・国内データ保管要件との相性が悪い。選択肢⑤はローカル完結処理が可能。
4. **ライセンスコストの段階的投資**: 選択肢①の正式契約は年間コストが数百万円規模になり得る。まずハイブリッド案で実運用ニーズを検証し、DWG完全対応が本当に必須と確認できてから投資対効果を精査してODA正式契約に踏み切る方が財務的に妥当。
5. **法的リスクの回避**: 選択肢③(LibreDWG直接リンク)はGPLv3のcopyleft波及リスクがあるが、選択肢⑤はODA File Converterを外部プロセスとして呼び出す(リンクしない)構成のため自社コードへの影響を避けやすい(配布条件は要最終確認)。

### 完了基準達成への懸念(要記録)

ハイブリッド案は「DWGの完全ネイティブ往復」ではなく「DXF経由の変換ブリッジ」であるため、DWG固有の高度な機能(カスタムオブジェクト、一部の拡張entity等)で情報欠落が生じる可能性がある。改善台帳の完了基準「実案件100図面の許容差合格」を満たせるかは、実案件サンプルでの検証を経て初めて判断できる。許容差不合格が頻発する場合は選択肢①への早期移行を検討する。

## 影響

- **短期**: `src/importers.js`にDXF**書出し**機能を追加(P1-04/P1-05と一部重複するタスク分解が必要)。Node.jsサーバーからODA File Converter CLIを呼び出すラッパーサービスを新設(サブプロセス起動、一時ファイル管理、タイムアウト・サンドボックス設計)。
- **中期**: 実案件100図面でのround-trip許容差検証パイプラインを構築(自動比較ツールが必要になる可能性が高い)。
- P1-03自体を以下のサブタスクへ分解することを推奨:
  - P1-03a: DXF書出し実装
  - P1-03b: ODA File Converter CLIラッパー(DWG⇔DXF変換マイクロサービス)
  - P1-03c: 実案件100図面での許容差検証・回帰テスト整備。**幾何許容差だけでなく、entity種別(現状`parseDxfImport`が`normalizeDxfEntity`未対応のHATCH/DIMENSION/INSERT等を警告のみで破棄している)、entity属性、layer詳細属性、layout情報の保持を受入条件に含める。未対応entityは明示的に入力を拒否するか、非破壊のopaque dataとして保持する方式のいずれかを選定する**
  - P1-03d(条件付き): ODA Drawings SDK正式契約・ネイティブDWG対応(③検証で不足が判明した場合のみ)
- 依存関係にあるP1-04・P1-05・P1-06はDXF書出しの完成を前提にするため、着手順序としてP1-03a→P1-04/P1-05→P1-03bが現実的。

## 次のステップ(人間承認が必要な事項)

グローバルポリシー(SDKライセンス契約・費用発生を伴う意思決定は人間承認必須)に基づき、以下は本ADRの範囲外とし、人間(CTO/経営)の承認を要する。

1. **ODA File Converterの商用利用許諾の取得(P1-03bの着手前提条件)**: 非会員は非商用評価用途限定のため、商用プロダクトへ組み込む前にODA会員契約または明示的な許諾をODA公式に照会・取得すること。許諾が得られない場合、選択肢⑤は成立しないため選択肢①の前倒し検討に切り替える
2. ODA Drawings SDK正式契約の予算化判断(年間コスト概算: 初年100〜170万円規模、継続80〜130万円規模、Founding Memberはさらに数倍。契約前に最新見積りを要取得)
3. LibreDWG等GPLライセンスコードを自社製品に組み込む場合の法務確認(現時点では非推奨のため不要だが、将来の方針転換時に必須)
4. 実案件図面データの外部送信可否のポリシー確認(選択肢④を将来再検討する場合)
5. 上記タスク分解(P1-03a〜d)に基づく工数計画・スケジュールの承認

## 参考情報源

- Open Design Alliance Pricing / Membership FAQ: https://www.opendesign.com/pricing , https://www.opendesign.com/faq/membership
- ODA File Converter: https://www.opendesign.com/guestfiles/oda_file_Converter
- ODA FAQ「What are ODA Viewer and ODA File Converter」(非会員は非商用限定): https://www.opendesign.com/faq/question/what-are-oda-viewer-and-oda-file-converter
- LibreDWG Manual (v0.13.4): https://www.gnu.org/software/libredwg/manual/LibreDWG.html
- Autodesk Platform Services 価格体系(2025年12月〜、Free/Paid二層・Flex tokens): https://aps.autodesk.com/blog/aps-business-model-evolution , https://aps.autodesk.com/aps-sales
- Autodesk Platform Services Model Derivative API: https://aps.autodesk.com/model-derivative-api-2d-3d-conversions
- Autodesk AutoCAD OEM / RealDWG (Tech Soft 3D経由): https://aps.autodesk.com/developer/overview/autocad-oem
