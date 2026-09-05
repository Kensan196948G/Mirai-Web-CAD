# Cloudflare Access変更Runbook

Access変更は`infra/cloudflare/`のTerraformだけで行い、緊急時を除きダッシュボードから直接変更しません。MVPの許可対象は`kensan1969@gmail.com`だけです。

## 変更前

1. 変更理由、対象Application、作業者、戻し方をIssueへ記録する。
2. API tokenが対象資源限定でTunnel、DNS、Access Apps and Policiesの必要最小権限だけを持つことを確認する。
3. `npm run infra:check`、`terraform fmt -check`、`terraform validate`を成功させる。
4. 保存済みplanをレビューし、意図しない作成・置換・削除が0件であることを確認する。

次の差分は適用禁止です。

- `everyone`、メールドメイン全体、`bypass`、恒久Service Token
- MVP許可メールの追加・置換
- Tunnel、DNS、Access Applicationのdestroy/recreate
- planに現れないダッシュボード直接変更

## 適用と確認

```bash
terraform -chdir=infra/cloudflare plan -out=change.tfplan
terraform -chdir=infra/cloudflare show change.tfplan
terraform -chdir=infra/cloudflare apply change.tfplan
sudo systemctl start mirai-web-cad-mvp-monitor.service
sudo systemctl show mirai-web-cad-mvp-monitor.service -p Result -p ExecMainStatus --no-pager
```

未認証でMVPが302、ログイン画面の対象Application名が`mirai-web-cad-mvp`、認証後health・作図・保存が成功することを確認します。一時E2E Service Tokenを使用した場合は、試験直後にpolicyとtokenを削除し、通常policyがメール1件だけであることを再確認します。

## ロールバック

直前のTerraformコードへ戻して新しいplanを作り、差分をレビューしてapplyします。Accessを`bypass`へ変更するロールバックは禁止です。API操作不能時はローカルサービスを停止してデータ更新を止め、Access管理権限を持つ担当者へエスカレーションします。
