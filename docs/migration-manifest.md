# 独立リポジトリ移行Manifest

移行日: 2026-08-26  
移行元: `Kensan196948G/Construction-Enterprise-OS`の`Mirai-Web-CAD/`  
移行先: `Kensan196948G/Mirai-Web-CAD`

## 移行結果

ソース正本、CI、Issue、Cloudflare production branchの独立repo移管は完了した。初回本番配信はGitHub PATのActions Secrets管理権限不足により、CI成功済みの同一commitをローカルWrangler認証で配信した。Actionsからの自動Deploy有効化とProduction required reviewerはIssue #9で追跡する。

| 項目 | 結果 | 証跡 |
| --- | --- | --- |
| 新repo | PASS | `Kensan196948G/Mirai-Web-CAD`、Private、default branch `main` |
| PR | PASS | 新repo PR #1、merge commit `c93a917fe5632234b5cbb5f46abfba9fb1a78ece` |
| CI | PASS | run `32936884367`、Application/Migration/Recovery/Secret Scan成功 |
| Preview | PASS | deployment `6950bcc0`、実Neonに対するdesktop/mobile E2E 12/12成功 |
| Production | PASS | deployment `81194e17`、Pages production branch `main` |
| Public boundary | PASS | SPA/health/demo 200、private drawing/write 401、CSP違反0 |
| DB | PASS | Neon connected、migration適用済み。データ移行なし |
| 旧deploy停止 | PASS | 移行元PR #26、merge commit `b06d0108a459576daf4f9f047b58be550b3ee309` |
| Construction OS | PASS | 別Pages project。公開URLは既存302のまま |
| Issue | PASS | 移行元#20-#23を新repo#5-#8へtransfer、移行元#24を完了close |
| Actions deploy | BLOCKED | Secrets API 403。Deploy jobは変数未設定時fail-closed。新repo#9で追跡 |
| Production承認 | PARTIAL | protected branch限定。Private repoの現行planではrequired reviewer設定が422 |

## 方針

- GitHub公式手順に従い、使い捨てcloneで`git filter-repo --subdirectory-filter Mirai-Web-CAD`を実行した。
- Cloudflare Pages project `mirai-web-cad`、Custom Domain、Neon DBは維持する。
- DNSおよびDBデータを移動しない。
- 移行元はrollbackと過去PR参照のため直ちに削除しない。
- 秘密値は履歴へ含めず、新repoのGitHub Actions Secretsへ再登録する。

## Commit対応

| 移行元 | 移行先 | 内容 |
| --- | --- | --- |
| `043b706` | `acd1ac7` | MVP Preview |
| `9f3cf1d` | `4144fa1` | Production release記録 |
| `c6a0fea` | `f1ff922` | 新規作成、DXF Import、コマンドライン |
| `b203400` | `cf08b80` | 本番運用適合性・公開境界改善 |
| `ac6f700` | `6c1a40a` | Cloudflare Analytics CSP |

履歴抽出によりSHAは変わる。過去PR #15、#17、#18、#19、#25の正本は移行元リポジトリに保持する。

## 外部基盤

| 対象 | 移行方針 |
| --- | --- |
| Cloudflare Pages | 既存projectを維持し、production branchだけを`main`へ変更 |
| Custom Domain | `mirai-web-cad.mirai-dx-platform.com`を維持。DNS変更なし |
| Neon | 既存Production DBを維持。project分離は別変更 |
| GitHub Secrets | 現PATではSecrets APIが403。秘密値をGitへ保存せずIssue #9で追跡 |
| Issues | 移行元#20-#23を新repo#5-#8へ移管し、移行元#24に本manifestと結果を記録 |

## Cutover Gate

- PASS: 新repoのLint、Type、Unit/API、E2E、A11y、Build
- PASS: 空DB Migration、backup/restore、secret scan
- PASS: PreviewのSPA/API/DB/認証境界
- PASS: `main`のbranch protection、force-push/delete禁止、必須4チェック
- PARTIAL: Production Environmentは保護branch限定。required reviewerはplan制約
- PASS: 旧Production workflowのpush trigger停止
- PASS: ProductionのSPA/health/demo 200、private drawing/write 401
- PASS: Construction OSのPages projectとURLが不変

## Rollback

1. 新repoのProduction workflowを停止する。
2. Pages production branchを移行元branchへ戻す。
3. 移行元の既知正常commit `ac6f700`をPages projectへ再deployする。
4. 公開境界とConstruction OS非影響を再検証する。

移行後7-14日は移行元のコードとworkflowを保持する。安定化後、移行元フォルダを新repoへの案内へ置換する。
