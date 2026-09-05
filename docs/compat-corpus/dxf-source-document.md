# DXF原本保全基盤 (2026-09-05)

## 実装範囲

`src/dxf-source-document.js` に版付き原本文書モデルを追加した。
原本文字列を正規化せずJSONへ保存し、復元時も改行・BOM・空白・順序を維持する。
未知Entity、TABLES、BLOCKS、OBJECTS、HEADER、その他セクションも原本に残る。
復元は元の図面を返す処理であり、編集済み図面のDXF書出しではない。

BLOCKの意味情報は独立した読み取り専用ビューとして抽出する。

- 定義: 原本レコードID、名称、ハンドル、所有者、基点、フラグ、外部参照パス、子レコードID、ATTDEF。
- 参照: 定義へのレコードID、入れ子の親定義、位置、XYZ別尺度、回転、OCS法線、行列配列、レイヤー、紙空間・Layout名。
- 属性: 順序付きATTRIB、タグ、値、フラグ、位置、整列点、文字高さ、回転、スタイル。重複タグを辞書化して消さない。
- 診断: 定義名重複、参照先不明、孤立属性、SEQEND欠落等。幾何学的妥当性・循環参照の完全検査ではない。

原本レコードは全グループコードを保持する。上記の意味情報はその一部を抽出したビューであり、全DXF仕様の解釈ではない。
ビューの変更を原本へ反映するAPIはない。既存のchildren型ブロックへ平坦化もしない。

グループコードの確認資料: Autodesk [INSERT](https://help.autodesk.com/cloudhelp/2021/ENU/AutoCAD-DXF/files/GUID-28FA4CFB-9D5E-4880-9F11-36C97578252F.htm)、[ATTDEF](https://help.autodesk.com/cloudhelp/2023/ENU/AutoCAD-DXF/files/GUID-F0EA099B-6F88-4BCC-BEC7-247BA64838A4.htm)。

## 実行

```sh
node scripts/dxf-source-archive.mjs pack DXF-Test-Corpus artifacts/dxf-source-archive
node scripts/dxf-source-archive.mjs restore <archive.dxf.source.json> <new-output.dxf>
```

packは入力ディレクトリを再帰走査し、各DXFを相対パス付きのJSONに保存する。
UTF-8/ASCII限定。Shift-JISやバイナリDXFは対応せず、デコード不能を失敗として報告する。
JSON経由の復元後に原本バイト列との完全一致を検査する。
restoreは保存したSHA-256・バイト数も検査し、既存出力ファイルの上書きを拒否する。
チェックサムは破損検出であり、電子署名や改ざん耐性のある認証ではない。
原本を含むアーカイブには入力と同じ機密情報があるため、公開Gitへの登録はしない。

## 検証結果

合成100件を実行した結果:

| 検査 | 結果 |
| --- | --- |
| JSON保存後の原本バイト一致 | 100/100 |
| BLOCK定義抽出 | 570件 (システム定義・寸法匿名ブロックを含む) |
| INSERT参照抽出 | 125件 (入れ子・紙空間を含む) |
| ATTDEF / ATTRIB抽出 | 17件 / 49件 |
| 抽出エラー・参照構造診断 | 0件 |

詳細は `artifacts/dxf-source-archive/report.json`。CIで合成生成後に同じ原本一致試験を行う。
生成DXFと原本アーカイブはCI成果物に含めず、検査レポートのみ保存する。

## 未接続・残作業

この段階は独立したCLIと文書モデルの実装であり、ブラウザ取込・Drawing永続化・Undo/Redoには未接続。
既存の厳格取込を緩めていないため、編集互換の31件通過・69件拒否を改善するものではない。
原本保全100/100を、合成100件の編集互換認定や実案件100件の認定として集計しない。

次に必要な作業:

1. Drawingのブロック定義/参照モデルへの接続と、描画・ヒットテスト・変換・属性編集。
2. 元レコードと編集済みモデルの対応付け、ハンドル/所有者/参照整合性を保つDXF再生成。
3. 原本保管のAPI容量・永続化設計 (現在のAPI本文制限1MiBに原本を無条件で追加しない)。
4. DIMENSION、HATCH、Layoutのネイティブモデルと編集後往復。
5. 外部CADでの再読込・原本/正解PDF比較。
