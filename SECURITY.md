# Security Policy

## Reporting

脆弱性は公開Issueへ記載せず、GitHubのPrivate vulnerability reportingから報告してください。

報告には、影響範囲、再現手順、想定される悪用方法、修正案を含めてください。認証情報、実データ、個人情報は添付しないでください。

## Supported Version

本番へ配信されている`main`のみをサポート対象とします。重大な脆弱性では公開機能の停止または既知正常deploymentへのrollbackを優先します。

## Secrets

Cloudflare、Neon、GitHub、Entra IDの秘密値をGitへ保存しません。GitHub Actions SecretsまたはCloudflare Pages Secretsを使用し、用途別に最小権限で発行します。
