# Security Policy

## Reporting

脆弱性は公開Issueへ記載せず、GitHubのPrivate vulnerability reportingから報告してください。

報告には、影響範囲、再現手順、想定される悪用方法、修正案を含めてください。認証情報、実データ、個人情報は添付しないでください。

## Supported Version

本番へ配信されている`main`のみをサポート対象とします。重大な脆弱性では公開機能の停止または既知正常deploymentへのrollbackを優先します。

## Secrets

Cloudflare、GitHub、Entra IDの秘密値をGitへ保存しません。GitHub Actions SecretsまたはCloudflare Pages Secretsを使用し、用途別に最小権限で発行します。本番DB接続文字列は2026-08-30〜ローカルPostgreSQL(このホストのみ)を参照し、`~/.config/mirai-web-cad/*.env`(mode 0600、リポジトリ外)にのみ保存します。GitHub・Cloudflareいずれにも本番DB接続文字列を保存しません。
