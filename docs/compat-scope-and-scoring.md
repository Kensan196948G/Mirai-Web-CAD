# 代替範囲・採点基準

更新日: 2026-08-30

**本書は[80～90％代替・AI統合開発方針](Mirai-Web-CAD_80-90％代替・AI統合開発方針.md)(以下「方針文書」)の実装仕様である。本書と方針文書が矛盾する場合は方針文書を優先し、本書を是正すること。**

方針文書のPhase 0(代替率測定基盤・100図面台帳・互換コーパス)完了基準のうち「80%、90%及び対象外を明文化」「実装済み/限定対応/計画の表示が最新状態と一致する」に対応する。

## 1. 対象業務の固定定義

方針文書§1の通り、代替対象を以下の土木2Dワークフローに固定する。

> 土木2D施工図の受領 → 内容確認 → 修正 → レビュー・承認 → 尺度保証PDF／DXF返却 → 版・監査保存

3D、BIM authoring、レンダリング、機械・電気専用CAD、LISP完全互換を含む全製品代替は対象外(方針文書§1)。

## 2. 80%必須範囲の現状(方針文書§2.1)

| # | 必須範囲 | 現状 | 対応するdocs/README表記 |
|---|---|---|---|
| 1 | DXFの読込・編集・書出し | 限定対応(DXF読込: LINE/CIRCLE/LWPOLYLINE/POLYLINE/ARC/TEXT/MTEXTの7種、未対応は警告付きスキップ)。**DXF書出しは実装予定**(Phase 1)。DWGは対象外([ADR-0002](adr/ADR-0002-dwg-scope-drop-dxf-only.md)) | README「Import」行 |
| 2 | 主要2D図形と精密編集 | 限定対応。TRIM/EXTENDは境界交点でなく線端座標移動、ポリラインOFFSETは真の平行曲線でなく重心基準の放射移動のため精密編集に形状誤差が生じ得る | README「作図」行 |
| 3 | 寸法、文字、ハッチ、ブロック、レイヤー | 限定対応。`DIM`は2点間簡易寸法のみ、`HATCH`は島・境界探索なし、`BLOCK`は簡易構造(定義/参照分離・属性再定義・ライブラリ未対応) | README「コマンドライン」「レイヤー」行 |
| 4 | レイアウトと尺度保証PDF | 限定対応。`window.print()`ベースの印刷は動作するが、ベクタ・尺度保証PDF出力は未実装(Phase 1、方針文書のP1-06相当) | README「レイアウト」「CAD互換範囲」行 |
| 5 | 案件・図面権限 | 限定対応。5ロール(閲覧者/作図者/レビュアー/承認者/CAD管理者)のRBACは実装済み。案件・工区・組織単位の管理は未実装(Phase 2) | README「権限」行 |
| 6 | 版、差戻し、承認、監査 | 限定対応。下書き/レビュー提出/承認/新版作成、DB追記専用の監査ログ、CSV exportは実装済み | README「版/承認」行 |
| 7 | 大規模図面の実用性能 | 一部対応。viewportカリング・空間インデックス(uniform grid)による描画最適化は実装済み。`hitTest`・OSnap・窓選択への適用、差分描画、Web Worker化、fps実測は未着手(Phase 2) | state.json blocked_issues #7 |
| 8 | クラッシュ復元とバックアップ | 限定対応。ブラウザ側はLocalStorage平文自動保存のみ(暗号化IndexedDB・差分autosave・クラッシュ復元は未実装、Phase 2)。本番DBの日次バックアップ・復元訓練は実装済み | README「保存」行、docs/operations.md |
| 9 | 土木施工図の基本テンプレート | 未着手。社内・国交省・自治体図枠presetはPhase 1範囲 | (未記載、本書で追跡開始) |

## 3. 90%追加要件の現状(方針文書§2.2)

以下11項目は全て未着手または計画段階(Phase 1〜3)であり、80%必須範囲の完成を優先する方針文書の開発順序に従う。

外部参照XREF / 複数レイアウト・Sheet Set相当 / 図面比較 / JGD2011・JGD2024及び平面直角座標系 / 電子納品検査 / GIS・BIM参照連携 / 協力会社レビュー・配布・受領確認 / オフライン閲覧・朱書き / 100,000図形級の実用性能 / オフサイトバックアップ及びDR実測 / 実案件100図面以上の継続的な互換認定

## 4. 明示的な対象外(方針文書§2.3 + Phase 0限定の測定対象外)

### 4.1 恒久的対象外(方針文書§2.3)

高度な3Dモデリング / BIM authoring全般 / レンダリング / 機械・電気専用CAD機能 / AutoLISP・ARX等の完全互換 / AutoCAD全業種向け機能の網羅 / DWGバイナリ形式([ADR-0002](adr/ADR-0002-dwg-scope-drop-dxf-only.md))

3Dソリッドを含む図面(内部CADモデルが2D entityのみ対応のため)はここに該当し、Phaseによる再評価対象ではない。台帳(`docs/compat-corpus/ledger.json`)では`scope: "out-of-scope"`、`outOfScopeReason`にこの節を引用して登録する(4.2の再評価対象とは区別する)。

### 4.2 Phase 0時点での比較器・採点の測定対象外(本書で新規に定義)

以下は個々の図面属性として、Phase 0の比較器([drawing-compare.js](../src/drawing-compare.js))による採点対象から除外する。恒久的対象外ではなく、各Phaseでの再評価対象。

| 属性 | 対象外の理由 | 再評価Phase |
|---|---|---|
| XREF依存図 | 外部参照は90%要件(§2.2)、現行はimport時に単一図面へフラット化する設計がない | Phase 2 |
| SHXカスタムフォント埋め込み | フォント埋め込みの解釈は未実装、日本語フォントは別途Phase 1のPDF出力で対応予定 | Phase 1 |
| プロキシ・カスタムオブジェクト | DXFの非標準entity、ADR-0001が「非破壊のopaque保持」を受入条件として要求(P1-03c) | Phase 1 |
| ラスタ画像埋め込み | 現行entityモデルに画像entityがない | 未計画 |
| シートセット | 複数レイアウトは90%要件(§2.2) | Phase 2以降 |

**対象外の追加は本書のPRと[改善台帳](improvement-register.md)への記録を必須とする。** 合格率を作為的に引き上げる目的での対象外の事後拡大を防ぐため。

## 5. 採点9軸の定義

[compat-score.js](../src/compat-score.js)の`AXIS_WEIGHTS`に対応する。各軸は分母(`checked`)を必ず持ち、分母0件の軸はスコア1(該当なしとして減点しない)として扱う。

| 軸 | 検査単位(分母) | 主な検査内容 |
|---|---|---|
| entity | 期待側entity件数 | 件数一致、欠落(critical)/余剰(major)の検出 |
| coordinate | ペア成立entityの座標点数+スカラー量(半径・幅高さ・回転等) | 各点の位置偏差が許容差以内か |
| layer | レイヤー属性数(4: color/visible/locked/printable)×レイヤー件数 + entity帰属件数 | color・visible・locked・printableの一致、entity→layer帰属の保存。名称(name)はレイヤーの対応付け(マッチング)に用い、分母には含めない |
| block | ペア成立block entity件数×5 | name・insertion・rotation・scale・children/attributes |
| text | ペア成立text entity件数×3 | value(正規化後完全一致)・at・size |
| dimension | ペア成立dimension entity件数×5 | 2点・offset・precision・suffix |
| layout | 固定6項目(paper/orientation/scale/margin/title/unit) | 用紙・尺度・単位の一致 |
| linetype | ペア成立entity件数×3 | strokeWidth・lineDash・fill |
| print | printableレイヤー数 + ペア成立entity件数 | レイヤーのprintableフラグ保存、entityの実効的な印刷対象状態の一致(**ラスタ比較ではなく決定論的要素の一致のみ**。真の尺度保証PDF比較はPhase 1のベクタPDF実装後) |

比較除外フィールド(往復のたびに必ず変わる、または対象外): `id`、`meta.createdAt`、`meta.createdBy`、`updatedAt`、`createdAt`、`revision`、`version`、`commandEvents`、`auditLog`、`comments`([IGNORED_FIELDS](../src/drawing-compare.js)参照)。

## 6. 許容差表v0(初期提案値)

**方針文書に座標等の具体的な許容差数値の記載はない。** 以下はCAD製図における一般的な精度慣行(用紙上の実用限界0.1mm程度、電子納品基準系の座標非改変原則、DXF実装の一般的な小数出力桁数)を踏まえた初期提案値であり、実案件図面到着後の再校正が前提。

| 項目 | v0初期値 |
|---|---|
| 座標(絶対) | 0.01mm |
| 座標(相対) | 図面対角長×1e-6 |
| 角度 | 0.001度 |
| 文字位置・サイズ | 0.05mm / 0.01mm |
| 文字内容 | 完全一致(NFC正規化・行末空白除去後) |
| 尺度・用紙・単位 | 完全一致 |
| 線幅・破線パターン | 0.01(無次元/mm) |

軸別重み(合計1.00): entity 0.20 / coordinate 0.20 / layer 0.12 / text 0.12 / dimension 0.10 / block 0.08 / layout 0.08 / linetype 0.05 / print 0.05。

数値の正本は[TOLERANCE_V0](../src/compat-score.js)・[AXIS_WEIGHTS](../src/compat-score.js)。本書との数値相違があれば、コード側を正としテストで固定された値に本書を追従させること。

### 再校正手順

閾値を実データより先に固定しない。実案件図面(開発回帰20図面)が到着した時点で、まず`node scripts/compat-report.mjs --mode=calibration --file=<図面>`で合否を出さず座標偏差の分布(p50/p95/max)のみを観測し、p95等を踏まえて`TOLERANCE_V0`を再校正する。再校正は`src/compat-score.js`の定数変更のみで完結し、`src/drawing-compare.js`(差分エンジン)の変更は不要。

## 7. 合否判定

- **pass90**: 総合スコア ≥ 0.99 かつ 全軸 ≥ 0.95 かつ critical findingが0件
- **pass80**: 総合スコア ≥ 0.95 かつ critical findingが0件(方針文書§2.1「95%以上が許容差内」の実装)
- **out_of_scope**: 台帳(`docs/compat-corpus/ledger.json`)で`scope: "out-of-scope"`の図面。**コーパス全体合格率の分母から除外し、除外件数を必ず併記する**
- **fail**: 上記以外

コーパス全体合格率 = 合格件数(pass80+pass90) / 測定可能件数(`measurableEntries()`、利用許諾未取得・期限切れ・対象外を除く)。除外件数・ブロック件数(下記8参照)は常に併記し、分母への混入を防ぐ。

## 8. 未対応entity非破棄ポリシー

| Lv | 内容 | 状態 |
|---|---|---|
| L0 | 黙って破棄 | 禁止 |
| L1 | 種別ごとに警告を提示 | (旧)警告50件超で切り捨てが発生し得た |
| L2 | 構造化された`skipped`要約 + 件数のUI常時表示 + 警告切り捨て時の明示通知 + 保存則(`entityCount + skipped + failed === sourceCount`)の検証 | 実装目標(改善台帳P0-39) |
| L3 | opaque非破壊保持 または 明示的な受入拒否 | Phase 1(ADR-0001受入条件、P1-03c) |

## 9. 現時点で測定不能な項目とブロッカー

| 項目 | ブロッカー | 参照 |
|---|---|---|
| DXF往復比較(`--mode=dxf-roundtrip`) | DXF書出し未実装 | ADR-0001 P1-03a |
| ベクタ・尺度保証PDF比較 | PDF出力未実装 | P1-06(方針文書ロードマップ) |
| 実案件100図面での測定 | 実案件図面が未到着(人間側のタスク) | docs/compat-corpus/README.md |

## 10. DWG対応方針

DWGは対象外である([ADR-0002](adr/ADR-0002-dwg-scope-drop-dxf-only.md)参照)。旧バージョン方針([ADR-0001](adr/ADR-0001-dwg-dxf-roundtrip-engine.md)補遺)は破棄した。
