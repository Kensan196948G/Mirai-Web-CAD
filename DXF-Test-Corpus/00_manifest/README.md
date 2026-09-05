# DXF-Test-Corpus

CAD処理系（DXF読込/変換/表示）の開発・検証用テストコーパス。
主分類10種類・合計100ファイルのASCII DXF。

## 構成

| フォルダ | 主分類 | ファイル数 |
|---|---|---|
| 00_manifest/ | マニフェスト・ドキュメント | 4 |
| 01_dimension/ | 寸法（DIMENSION実体・公差・スタイル） | 15 |
| 02_hatch/ | ハッチ（SOLID/パターン/島/穴/曲線境界/連想） | 10 |
| 03_block/ | ブロック（BLOCK+INSERT・回転・尺度・入れ子） | 10 |
| 04_attribute_block/ | 属性付きブロック（ATTDEF+ATTRIB・日本語属性） | 10 |
| 05_text_annotation/ | 文字・注記（TEXT/MTEXT・日本語・引出線） | 10 |
| 06_layer_display/ | レイヤー・表示属性（線種/線幅/TrueColor/BYLAYER/BYBLOCK） | 10 |
| 07_layout_print/ | レイアウト・印刷（Paper Space/Viewport/図枠） | 10 |
| 08_curve_precision/ | 曲線・精密形状（ARC/ELLIPSE/SPLINE/大きな座標） | 10 |
| 09_civil_composite/ | 土木複合図面（道路/擁壁/排水/仮設の組合せ） | 10 |
| 10_large_special/ | 大規模・特殊要素（大量図形/未知データ/XREF相当） | 5 |
| **合計** | | **100 DXF** |

## 共通メタデータ

| 項目 | 値 |
|---|---|
| 形式 | ASCII DXF (R2000)、gradient HATCHのみR2004 |
| 生成CAD | 合成ジェネレータ (ezdxf)。実CAD出力ではない |
| 単位 | m（$INSUNITS=6） |
| 想定縮尺 | 1/100 |
| 用紙 | A3 420×297mm（レイアウトありのファイル） |
| エンコーディング | ASCII DXF（日本語注記はUnicodeエスケープ。Shift-JISバイト列ではない） |
| フォント | txt.shx（閲覧側CADの標準SHXに依存） |
| 匿名化 | 完了（実案件データを含まない合成図面） |

各ファイルの詳細（要約・特徴タグ・生成情報）は `corpus_manifest.csv` / `corpus_manifest.json` を参照。

## 重要な注意（実案件100件との関係）

- **このコーパスは「開発用サンプル」** である。合成生成のため、実CAD出力特有の
  挙動（独自ヘッダ変数・Proxy完全再現・印刷スタイル等）は再現しきれない。
- 最終受入用（回帰20件＋業務受入80件＝実案件由来100件）は、**実CADから出力した
  DXF＋正解PDF** で別途構成すること。本コーパスの100件には加算しない。
- 実案件ファイルに求められる添付物（CAD名・バージョン・出力DXFバージョンの記録、
  全レイアウト分の正解PDF、外部参照・再配布可能フォント、利用許諾記載）は
  `LICENSE_AND_USAGE.md` と manifest の該当列に従って整備する。

## 再生成

```bash
python3 -m venv ../artifacts/corpus-venv
../artifacts/corpus-venv/bin/pip install -r requirements.txt
../artifacts/corpus-venv/bin/python build_corpus.py
```

上記は`DXF-Test-Corpus`をカレントディレクトリにしたLinuxでの手順。Windowsでは仮想環境の`Scripts/python.exe`を使用する。生成はスクリプト自身のフォルダへ出力し、同名の生成済みDXF/manifestは上書きする。

生成後に全ファイルの再読込、構造監査(修復も失敗扱い)、単位、主要Entity、連想ハッチ・属性フラグ・Viewportの一部設定を検査する。結果とSHA-256は`00_manifest/verification.json`へ出力。検証成功時は`verified 100/100`と`DONE: 100 DXF files`を表示する。Python 3.12.3 / ezdxf 1.4.4で実行済み。

## 検証範囲の制限

- `features`はシナリオの要求タグであり、全タグの実体を保証しない。`verification.json`の実体集計と検査結果を併用する。
- `large_03_proxy_entity`にACAD_PROXY_ENTITY実体はない。`xref_like`は通常の内部ブロックであり、実際の外部参照ではない。
- `mtext_fields`は通常の注記文字列であり、動的FIELD実体ではない。`table_like`もTABLE実体ではない。
- 大規模データは最大約3,000図形で、100k性能認定には不足する。
- `oblique`は傾斜線の平行寸法であり、寸法補助線の斜交設定を検証しない。
- 全シナリオのCAD表示・編集動作、日本語フォント描画、連想更新、正解PDFとの尺度・印刷比較は未検証。
- マニフェストのbucketは`synthetic-regression`。実案件20/80枠へは登録しない。

## 利用許諾

`LICENSE_AND_USAGE.md` を参照。
