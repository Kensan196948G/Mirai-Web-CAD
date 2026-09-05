# Cloudflare Terraform

Mirai Web CADの既存Cloudflare Tunnel、2つのCNAME、MVP Access ApplicationをTerraformで管理するための構成です。新規環境の作成用ではなく、**稼働中資源をimportしてから管理へ移す**ことを前提にしています。

## 管理範囲

- ローカル管理Tunnel `mirai-web-cad`の登録情報
- `mirai-web-cad.mirai-dx-platform.com`と`mirai-web-cad-mvp.mirai-dx-platform.com`のCNAME
- MVPホスト全体のAccess Application
- MVPを`kensan1969@gmail.com`だけに限定するallow policy

初回importでは既存policyを意図せず更新しないよう、Application側は棚卸ししたpolicy UUIDとprecedenceだけを参照します。policy本文がメール完全一致のallow 1件であることは棚卸し記録と初回planで照合し、差分がある状態ではapplyしません。

Tunnel ingress自体はローカルの`~/.cloudflared/mirai-web-cad-config.yml`で稼働するため、正本テンプレートは`deploy/cloudflared/mirai-web-cad-config.example.yml`です。Tunnel secretやcredentials JSONはTerraformへ渡さず、stateにも保存しません。

## 必要な権限

専用API tokenへ対象アカウント・zoneだけを指定し、Cloudflare Tunnel Read/Write、DNS Read/Write、Access Apps and Policies Read/Writeを付与します。Global API Keyは使用しません。token値は`CLOUDFLARE_API_TOKEN`環境変数だけで渡します。

## 初回import

1. `terraform.tfvars.example`を`terraform.tfvars`へ複製する。
2. `enable_management=false`のまま、APIまたはZero Trust画面から既存Access Application ID、そのApplication内のallow policy ID、2つのDNS record IDを調べる。policyの名前、decision、precedence、include/exclude/requireもコードと一致することを記録する。
3. 4つのIDを`terraform.tfvars`へ入力する。IDを推測してはいけない。
4. `enable_management=true`へ変更し、次を実行する。`imports.tf`はIDが全て揃うまで無効で、ID不足のまま管理を有効化するとplanが強制停止する。

```bash
export CLOUDFLARE_API_TOKEN='<scoped token>'
terraform -chdir=infra/cloudflare init
terraform -chdir=infra/cloudflare fmt -check
terraform -chdir=infra/cloudflare validate
terraform -chdir=infra/cloudflare plan -out=first-import.tfplan
terraform -chdir=infra/cloudflare show first-import.tfplan
```

最初のplanは4資源のimportだけで、Access policyを含む既存値に更新・追加・削除差分がないことを要求します。特にAccess policyの変更、`everyone`、`email_domain`、`bypass`、Service Tokenの常設、Tunnel/DNSの置換が表示された場合はapplyしません。

## 変更手順

```bash
npm run infra:check
terraform -chdir=infra/cloudflare fmt -check
terraform -chdir=infra/cloudflare validate
terraform -chdir=infra/cloudflare plan -out=change.tfplan
terraform -chdir=infra/cloudflare show change.tfplan
terraform -chdir=infra/cloudflare apply change.tfplan
```

適用後は`docs/runbooks/cloudflare-access-change.md`の検査を実行します。`terraform.tfvars`、state、plan、API tokenはコミットしません。`imports.tf`は条件付きの安全装置としてコード管理します。stateは所有者のみ読める場所へバックアップし、チャット・Issue・CI artifactへ添付しません。

## 現在の移行状態

コード、guardrail、CI検証は準備済みです。現行tokenにはDNSとAccess管理権限がなく、APIが`403/auth.forbidden`を返すため、実資源のID棚卸し・import・初回plan/applyは未実施です。権限付与後も最初にread-only inventoryを行い、既存設定との差分をレビューしてから管理を有効化します。
