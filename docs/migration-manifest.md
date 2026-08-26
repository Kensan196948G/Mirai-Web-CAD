# 独立リポジトリ移行Manifest

移行日: 2026-08-26  
移行元: `Kensan196948G/Construction-Enterprise-OS`の`Mirai-Web-CAD/`  
移行先: `Kensan196948G/Mirai-Web-CAD`

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
| GitHub Secrets | `CLOUDFLARE_ACCOUNT_ID`と`CLOUDFLARE_API_TOKEN`を新repoへ再登録 |
| Issues | #20-#23を移管し、#24に本manifestと結果を記録 |

## Cutover Gate

- 新repoのLint、Type、Unit/API、E2E、A11y、Buildが成功
- 空DB Migration、backup/restore、secret scanが成功
- PreviewのSPA/API/DB/認証境界が成功
- `main`のbranch protectionとProduction Environment承認を設定
- 旧Production workflowのpush triggerを停止
- ProductionのSPA/health/demoが200、private drawing/writeが401
- Construction OSのPages projectとURLが不変

## Rollback

1. 新repoのProduction workflowを停止する。
2. Pages production branchを移行元branchへ戻す。
3. 移行元の既知正常commit `ac6f700`をPages projectへ再deployする。
4. 公開境界とConstruction OS非影響を再検証する。

移行後7-14日は移行元のコードとworkflowを保持する。安定化後、移行元フォルダを新repoへの案内へ置換する。
