# 合成DXFコーパスの実行結果

2026-09-05、ユーザー提供の`DXF-Test-Corpus/build_corpus.py`をPython 3.12.3 / ezdxf 1.4.4の専用venvで実行した。受領版は角度寸法の引数エラーで4件目に停止したため、API不整合と生成内容の誤りを修正した。受領版バックアップはローカル`artifacts/build_corpus.received.py`に保持。

## 生成・検査

- 10分類・100 DXFを生成。CSV/JSON manifestは各100件、パス重複なし。
- `verified 100/100` / `DONE: 100 DXF files`、全件ezdxf再読込とaudit成功。auditによるエラー・自動修復とも0。
- 寸法・角度/半径、ブロック挿入・属性配置、連想ハッチ、内周境界、グラデーション、TrueColor、MTEXT位置、LEADER、Viewport設定、Spline API等を修正。
- DIMENSION/HATCH/INSERT/ATTDEF/ATTRIBの存在、INSUNITS=6、ASCII出力、連想ハッチ参照、非表示属性、Viewportロック・クリップ参照の一部を検査。
- DXF版はAC1015(R2000)99件、gradient HATCHのみAC1018(R2004)1件。文字はUnicodeエスケープでASCII出力。単位はm。
- 検査結果・SHA-256・Entity数は`DXF-Test-Corpus/00_manifest/verification.json`。図面・生成manifest・検証JSONはGit対象外、生成スクリプト・利用条件・手順はGit管理する。
- CIに合成生成・auditジョブを追加。これはCAD互換合格を意味しない。

## Miraiの限定往復回帰

```bash
node scripts/check-dxf-samples.mjs DXF-Test-Corpus artifacts/synthetic-corpus
```

今回の結果は**31/100通過、69/100不合格**。期待どおり終了コード1。判定対象は原本のトップレベルEntity数・パーサー欠落・取込/書出し警告・内部モデル往復であり、全属性の原本比較ではない。

| 分類 | 通過/件数 |
| --- | ---: |
| 寸法 | 0/15 |
| ハッチ | 0/10 |
| ブロック | 0/10 |
| 属性付きブロック | 0/10 |
| 文字・注記 | 9/10 |
| レイヤー・表示 | 9/10 |
| レイアウト・印刷 | 0/10 |
| 曲線・精密形状 | 10/10 |
| 土木複合 | 0/10 |
| 大規模・特殊 | 3/5 |

パーサー内でHATCH 15、LEADER 1、VIEWPORT 21が通知なく除外されることを発見。初回のパーサー出力だけを母数にした検証では51件通過と誤判定したため、原本ENTITIESセクションのgroup-code集計を追加し31件へ訂正した。DIMENSION/INSERTもMirai正規化時に未対応警告で除外される。**本対応で修正したのは検証器であり、アプリの非破壊取込は未実装のまま**。

通過31件についても、文字のUnicode復元、文字Style、元レイヤー属性、bulge/fit pointの精度、単位、XDATA等の保持を保証しない。これらは別途原本との属性比較が必要。元のR12サンプル7件も再検証し7/7通過を維持。

## 残るデータ不足

合成データなので実案件100件へ加算しない。実CAD/正解PDFとの比較は未実施。Proxy・実XREF・動的Fields・TABLEは名前や要求タグのみで実体がなく、大規模データも最大3,004図形で100kには届かない。全シナリオの連想編集・日本語描画・印刷・尺度の認定も未実施。詳細は[提供コーパスREADME](../../DXF-Test-Corpus/00_manifest/README.md)参照。
