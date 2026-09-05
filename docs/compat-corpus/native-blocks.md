# Drawing接続済みの通常BLOCK (2026-09-05)

## 実装済み

- Drawing.blockDefinitionsに共有定義、entities内のblock.definitionIdに参照を保持する。
- 基点、入れ子、位置、回転、正の等方XY尺度、Z尺度値、順序付きATTDEF/ATTRIBを扱う。
- 参照のchildrenは描画用キャッシュ。トランザクション完了時に再構築し、共有定義と二重管理しない。
- レイヤー0の継承、非表示属性の非描画、定数属性の表示に対応する。
- DXF取込、Canvas描画、選択、移動グリップ、MOVE/COPY/ROTATE/SCALE、属性値フォーム、Undo/Redo、JSON再読込を接続した。
- 定義の一括更新はset_block_resourcesトランザクションで行い、全参照を再構築する。専用の定義編集UIはまだない。
- BLOCK_RECORD/BLOCK/INSERT/ATTDEF/ATTRIB/SEQENDをDXFへ再生成する。
- 取込成功した原本はDrawing.dxfSourcesに保存し、JSON・サーバーの図面保存に含める。
- 単一原本の対応済みBLOCK図面は、未編集なら原本を文字列完全一致でDXF書出しする。
- INSERTの移動・回転・正の等方尺度変更と既存ATTRIBの値変更は、原本の対象group値のみを更新する。HEADER/TABLES/BLOCKS/OBJECTS等、ハンドル、所有者リンク、未使用定義、改行を保持する。
- 原本保持経路は再解析した原本と現在モデルを照合して選択する。保存された比較用スナップショットを信用しない。
- 存在しない定義、循環、入れ子32段以上、展開20000図形超過、不正形状等を拒否する。
- リソースコマンド700000 bytes、取込コマンド全体750000 bytesを上限とし、API本文1MiBを無条件で超える取込をしない。

## 限定範囲

- ネイティブ化するのはINSERTから到達する定義。未使用定義は原本アーカイブには残るが、ネイティブライブラリ化しない。
- 定義内のLINE/CIRCLE/ARC/直線LWPOLYLINE/単純TEXT/入れ子INSERTに対応する。
- 非一様XY尺度、鏡像、MINSERT配列、3D/傾斜OCS、XREF、幅・bulge付きポリライン、複雑な文字整列は拒否する。
- 属性は単一行。重複タグは順序付きで編集する。属性のMTEXT/複雑な整列等は拒否する。
- 属性付きEXPLODE、定義参照BLOCKのMIRRORは未対応。通常BLOCKを新規作成する既存UI/コマンドは旧children型のまま。
- 参照のないDXFの未使用定義だけの取込、ライブラリUI、ATTSYNC等は未実装。
- 原本保持経路ではTABLES/OBJECTS、BYBLOCK色、線種、TrueColor、フォント定義を原本のまま保持するが、表示・編集対応や外部CADでの描画一致を意味しない。未知の連想情報の再計算もしない。
- 図形追加/削除/並替え、定義変更、レイヤー変更、単位/レイアウト変更、複数原本の合成、属性配置変更は原本保持経路の対象外。明示的な警告付きの従来の限定再生成となり、完全保持ではない。
- 原本保持には今回追加した原本レコード対応情報が必要。旧保存図面は原本DXFの再取込が必要になる場合がある。
- 鏡像・非一様尺度のネイティブ描画/編集/書出しは引き続き残作業。拒否を解除していない。
- 従来のCanvas表示倍率・CSS縦横比の課題 (#78)、尺度保証PDF、外部CADでの目視受入は別途残る。

## 検証

```sh
python3 -m venv artifacts/corpus-venv
artifacts/corpus-venv/bin/pip install -r DXF-Test-Corpus/requirements.txt
artifacts/corpus-venv/bin/python DXF-Test-Corpus/build_corpus.py
node --test tests/cad-block.test.js
node --test tests/dxf-source-export.test.js
node scripts/check-native-block-corpus.mjs
artifacts/corpus-venv/bin/python scripts/audit-native-block-corpus.py
npx playwright test tests/e2e/native-block.spec.js
```

上記はローカル用。CIは隔離した `/tmp/corpus-venv` を作成し、同じrequirementsからインストールする。

合成BLOCK10件・属性10件のうち18件が限定取込・書出し可能。鏡像を含む2件は拒否。
18件の未編集/編集後、計36出力を別実装ezdxfで元DXFと比較した。
比較対象は形状、基点、入れ子参照、INSERTの位置/回転/XYZ尺度、順序付き属性の値/位置/文字高さ/回転/フラグ、単位。
編集試験では移動・回転・拡縮と先頭属性値の変更を同時に適用し、元DXFへのezdxf変換結果と照合する。
36/36で一致し、ezdxf監査のエラー・自動修復は0件。
加えて未編集18件の原本完全一致と、編集前後36件の全非ENTITIESセクションのタグ列一致を検証する。フォント/色/線種/OBJECTS等の原本データ保持は含むが、その描画や連想更新の受入は含めない。

ブラウザはデスクトップ・モバイルで取込、属性変更、移動、Undo/Redo、再読込、ダウンロードDXFの再取込を検証する。
PostgreSQL統合試験には定義と原本のJSONB復元確認を追加した。
図面比較器はネイティブBLOCKの子形状と非表示を含む順序付き属性の差分も検出する。

原本保全100/100、今回の限定比較36/36、完全互換認定は混同しない。
合成100件の警告なし合格や実案件100件の認定を達成したとは数えない。

100件全体の既存チェッカー再実行では、従来基準の合格31件、警告等で不合格だが往復できた24件、取込等で拒否45件となった。
レポートは `artifacts/synthetic-corpus-native-blocks/report.json`。従来の31件も完全な原本比較認定ではない。
