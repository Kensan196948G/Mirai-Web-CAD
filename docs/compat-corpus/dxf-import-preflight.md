# DXF取込の一括拒否ガード

2026-09-05。合成100件で発見した「未対応Entityがパーサー内で消え、残りだけ取込成功となる」問題への第一段階。

- ブラウザと検証CLIで同じ`src/dxf-source-inventory.js`を使用する。
- ENTITIESの原本group-code集計をパーサーより先に行い、未対応型を種別・件数付きで拒否する。HATCH/LEADER/VIEWPORT、DIMENSION/INSERT、Proxy/Custom、ATTRIBが対象。
- 元図形数に10,000件制限を適用し、パーサー内の除外で上限を回避させない。
- 対応型でも、原本と解析結果の型別件数が違う場合や、正規化できない図形がある場合は全体を拒否する。
- 取込コマンドを返す前にエラーとなるため、既存図面・レイヤー・図面名・保存・Undo履歴へ部分変更を適用しない。
- JSON取込の既存動作は変更しない。

## 検証

単体でHATCH/LEADER/VIEWPORT/DIMENSION/INSERT/Proxy/Custom、特殊な型名、変換不能円、原本10,001件を検証。ブラウザではdesktop/mobileで混在DXFの拒否後にLocalStorageが完全一致すること、再読込後も同じこと、続く正常DXFは取込可能なことを検証。

合成100件の結果は31件通過・69件拒否。判定を緩めず、従来不合格だった図面を欠落状態のまま編集させない。レポートはローカル`artifacts/synthetic-corpus-preflight/report.json`。

## 未完了

これは損失防止のための明示的拒否であり、未対応EntityのOpaque保存・編集・再書出しではない。DIMENSION/HATCH/BLOCKのネイティブ読書、Layout/Viewport、原本TABLES/OBJECTSや文字Style/単位/線種等の完全保持は後続。ENTITIES以外の未使用Block定義・辞書・Proxy Object等を包括的に検査するものでもない。100k入力と実案件100件認定も未完了。
