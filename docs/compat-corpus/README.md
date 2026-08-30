# 100図面台帳(compat-corpus)

80-90%代替方針(`docs/Mirai-Web-CAD_80-90％代替・AI統合開発方針.md`)Phase 0の完了基準
「100図面の台帳と利用許諾が存在する」に対応する台帳。

**重要: 実案件の図面ファイル自体はこのリポジトリにコミットしない。** 発注者の著作物かつ
機密情報(公共工事図面を含む可能性がある)であり、GitHubへの格納自体が著作権・機密保持の
観点で許諾違反になり得る。

## 構成

- `ledger.json`: 台帳の正本。図面ファイルの実体は持たず、`relativePath`(`MIRAI_CORPUS_DIR`
  からの相対パス)・`sha256`・統計値のみを記録する
- 図面ファイルの実体: 運用者が任意のローカルディレクトリに置き、`MIRAI_CORPUS_DIR`環境変数
  で指す(`.gitignore`の`corpus/`は慣例的なローカル配置先の一例)

## スキーマ

`entries[]`の各要素:

| フィールド | 内容 |
|---|---|
| `id` | `corpus-NNN`形式、不変 |
| `title` | 図面名(社内呼称等、機密情報を含めないこと) |
| `purpose` | `regression`(開発回帰20図面)/`uat`(最終UAT80図面)/`reference`(参考、集計対象外) |
| `scope` | `in-scope`/`out-of-scope`。`out-of-scope`の場合`outOfScopeReason`必須 |
| `source` | 出所(組織名・受領日・`sourceRef`)。**連絡先氏名・電話番号・案件名等の個人・案件識別情報は記録しない**。詳細はアクセス制御された外部の許諾記録側で管理し、`sourceRef`にその参照IDのみを記入する |
| `file.relativePath` | `MIRAI_CORPUS_DIR`からの相対パス。絶対パス・`..`は禁止 |
| `file.format` | Phase 0は`dxf`のみ受入(DWGはADR-0001のライセンス取得が前提のため対象外) |
| `file.originalDwgVersion` | 元図のDWGバージョン(例: `AC1032 (R2018)`)。Phase 0はASCII DXFのみ受入のため、提供元にはDWGではなくDXFでの提供を依頼した上で、元のDWGバージョンをここに記入してもらう。Phase 1のDWG対応バージョン確定に使う実データ |
| `license.status` | `granted`(許諾取得済み)/`pending`(未取得)/`denied`(拒否)/`internal`(社内図面等、許諾不要)。`granted`/`internal`以外は測定対象から自動的に除外される(下記) |
| `measurement` | 直近の採点結果。`scripts/compat-report.mjs`実行後に手動または将来の自動化で更新 |

## 利用許諾未取得の図面は測定できない(設計上の強制)

`scripts/lib/corpus-ledger.mjs`の`measurableEntries()`は、`license.status`が`granted`または
`internal`でない、または許諾が期限切れ(`license.expiresAt`超過)のentryを機械的に除外する。
これにより「許諾のない図面で採点を回してしまう」ことを構造的に防ぐ。

## 操作

```bash
# 図面を追加(既定はdry-run、標準出力に表示のみ。--writeで実際にledger.jsonへ追記)
node scripts/corpus-ledger.mjs add --file=<path> --title="県道○○線 平面図" \
     --purpose=regression --license-status=pending --organization="..." \
     --source-ref="許諾記録側の参照ID" [--write]

# 不変条件(id一意性、20/80枠、許諾状態等)を検証。CI相当のゲート
node scripts/corpus-ledger.mjs validate

# 集計(regression/uat件数、許諾済み件数、測定可能件数等)
node scripts/corpus-ledger.mjs stats

# Markdown表を標準出力へ出力(レビュー資料への貼付用、ファイルには書かない)
node scripts/corpus-ledger.mjs render

# MIRAI_CORPUS_DIR配下の実ファイルとsha256を突合(未設定ならskip)
MIRAI_CORPUS_DIR=/path/to/corpus node scripts/corpus-ledger.mjs verify-files
```

## 現在の状態

`ledger.json`は`entries: []`(0件)。実案件図面の到着を待っている状態。図面が届き次第、
上記`add`コマンドで登録する。20図面を開発回帰(`purpose=regression`)、80図面を最終UAT
(`purpose=uat`)に割り当てる方針(方針文書Phase 0)。
