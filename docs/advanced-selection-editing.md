# 高度な選択と追加編集

2026-09-05。今回の追加範囲を記録する。全CAD機能の完成を意味しない。

## 選択

| 機能 | 操作 | 範囲 |
| --- | --- | --- |
| Fence | リボンのフェンス選択で点をクリックしEnter、またはFENCE座標列 | 線分列と交差する可視図形 |
| Lasso | リボンの投げ縄選択でドラッグ、またはLASSO座標列 | 閉じた選択領域と交差/包含する可視図形 |
| Previous | SELECT PREVIOUS | 直前の選択セット。消去済み・非表示のIDを除外 |
| Last | SELECT LAST | 可視図形配列の最後の図形 |
| Similar | SELECTSIMILAR [id] | 選択した図形と同じ種類・レイヤー |
| Quick Select | QSELECT type line layer layerId color #rrggbb width 2 | 条件はAND。色は現在Canvasで使用するレイヤー色 |
| 選択セット | SELECTION SAVE/LOAD/DELETE name | 図面当たり100件、名前80文字。保存・削除は作図権限と監査・Undoの対象 |

保存セットは図面JSONとPostgreSQL保存経路へ含める。JSON取込で図形IDを再割当し、同名セットには連番を付けて既存セットを保持する。削除済みの図形IDは保存セットに残し、呼出時に除外する。元IDをUndoで復元すると再び選択できる。

Fence/Lassoの曲線は既存samplingまたは円/円弧256分割による近似。厳密な曲線接触、選択インデックス、属性検索・線種条件、類似条件のカスタマイズ、Fenceの追加/除外モードは後続。Lassoは最大2000点。

## 編集

```text
LENGTHEN 2400 lineId
REVERSE lineId
QSELECT type line
OVERKILL
PURGE
UNDO
```

- LENGTHEN: 正の全長指定。LINEは始点を固定し終点を移動。ARCは中心・半径・始角を固定して弧長を変更。全円以上は拒否する。
- REVERSE: LINE/PLINEの点順、SPLINEの制御点とknotを逆順にする。
- OVERKILL: 選択されたLINE/CIRCLEの完全重複のみ削除。方向を反転した同一直線も対象。同じレイヤー・表示属性・独自Metadataを要求し、作成日時/作成者以外の相違は保持する。寸法参照先とロック中図形は削除しない。
- PURGE: 未使用かつ非ロックのレイヤーのみ削除。現在レイヤーとBlock子図形の使用レイヤーを保持し、最後の1レイヤーを残す。

すべて既存トランザクションを利用する。LENGTHEN/REVERSE/OVERKILLはプロパティパネルの操作メニューからも利用可能。選択セットの保存・削除も同じ履歴へ記録する。

ALIGN/DIVIDE/MEASURE、許容差付き重複統合、重なり区間統合、Block/Style定義のPURGE、曲線全形式のLENGTHEN/REVERSEは未実装。CAD表現、寸法拡張、HATCH/BLOCKエンジン、DXF/PDF等も引き続き後続。

## 検証

単体で交差・包含・不可視除外、条件の組合せ、権限、保存/読込時のID再割当、長さ/逆順、削除対象の保護を検証。E2Eはdesktop/mobileでFence/Lasso、Previous、保存→Undo/Redo→再読込、全長変更、重複削除→Undo、PURGEを検証する。実案件UATと100k性能認定は含めない。
