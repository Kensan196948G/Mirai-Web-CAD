# ローカルデプロイ運用メモ

2026-08-30に、本番の永続化先をNeon PostgreSQLからローカルPostgreSQL + Cloudflare Tunnelへ移行済み(Issue #22、ユーザー指示による。移行完了としてclose)。systemd配置・Cloudflare Tunnel作成・DNS切替まで完了し、本番実測でSPA/health/demo 200、write 401(Cloudflare Access保護導入後は302)を確認済み。この文書は移行後の日常運用手順、およびセットアップ手順の記録(再構築・障害復旧時の参考)を兼ねる。移行の背景・設計判断は`docs/operations.md`の該当節を参照。

## 構成

```
Cloudflare Tunnel(mirai-web-cad-cloudflared.service)
  → mirai-web-cad.mirai-dx-platform.com
  → http://127.0.0.1:18812 (mirai-web-cad.service, scripts/serve-production.mjs)
  → ローカルPostgreSQL 16(127.0.0.1:5432, DB=mirai_web_cad, role=mirai_web_cad_app)
```

## 初回セットアップ

### 1. DB/ロール作成(実施済み)

```bash
sudo -u postgres psql -c "create role mirai_web_cad_app login password '<生成したパスワード>'"
sudo -u postgres psql -c "create database mirai_web_cad owner mirai_web_cad_app"
```

### 2. 接続情報ファイル(実施済み、mode 0600、リポジトリ外)

`~/.config/mirai-web-cad/production.env`:

```
DATABASE_URL=postgresql://mirai_web_cad_app:<password>@127.0.0.1:5432/mirai_web_cad
APP_ENV=production
AUTH_MODE=access
CF_ACCESS_TEAM_DOMAIN=<team>.cloudflareaccess.com
CF_ACCESS_AUD=<Access Application作成後に取得するAUD tag>
ACCESS_ROLE_MAP={"user@example.com":"cad_admin"}
CORS_ORIGIN=https://mirai-web-cad.mirai-dx-platform.com
```

`ACCESS_ROLE_MAP`の値は`src/cad-core.js`の`ROLE_POLICIES`に存在するロール名(`viewer`/`drafter`/`reviewer`/`approver`/`cad_admin`)のみを使うこと。`scripts/serve-production.mjs`は起動時にこれを検証し、不正な値があれば起動を拒否する。

**外部LLM連携(任意)**: 以下を追加すると`POST /api/drawings/:id/agent-runs`がルールベースAIで拾えなかったプロンプトをOpenAI/Anthropicへフォールバックする。未設定の場合はルールベースAIのみで動作し続ける(fail-soft)。

```
AI_PROVIDER=openai            # または anthropic。未設定なら外部LLMは無効
OPENAI_API_KEY=sk-...         # AI_PROVIDER=openaiの場合必須
ANTHROPIC_API_KEY=sk-ant-...  # AI_PROVIDER=anthropicの場合必須
AI_MODEL=<現行モデルID>        # AI_PROVIDER設定時は必須。値は各社公式ドキュメントで実装時点の現行版を確認しコードにはハードコードしない
AI_RATE_LIMIT_PER_MINUTE=10   # 任意、既定10。actor単位でLLM呼び出しのみを制限(ルールベース応答は制限しない)
```

APIキーはサーバーの環境変数のみで管理され、ブラウザには一切保存・送信されない(`GET /api/ai/status`は有効状態・プロバイダ名・モデル名のみを返し、鍵自体は返さない)。設定後は各プロバイダの管理コンソールで「学習利用オフ」等のデータガバナンス設定を人手で確認すること(コード外の運用手順)。

**Entra IDグループ同期(任意、Issue #5)**: 利用者ログイン自体はCloudflare Access One-Time PINのままとし、案件単位RBACのためのグループ所属取得のみをMicrosoft Graph APIへ非対話式(client credentials flow)でアクセスして行う。`ACCESS_ROLE_MAP`(メール直接指定)による解決が優先され、そこに一致しない利用者だけがEntra IDグループ経由で解決される。以下を追加すると有効化される。未設定の場合は`ACCESS_ROLE_MAP`とその後の`ACCESS_DEFAULT_ROLE`(既定`viewer`)のみで動作し続ける(fail-soft)。

```
ENTRA_TENANT_ID=<Entra IDテナントID>
ENTRA_CLIENT_ID=<App RegistrationのApplication (client) ID>
ENTRA_CLIENT_SECRET=<Client secret値>
ENTRA_GROUP_ROLE_MAP={"<グループGUID>":"reviewer","<グループGUID>":"approver"}
ENTRA_GROUP_CACHE_TTL_MINUTES=15   # 任意、既定15分。グループ変更の反映遅延の上限になる
```

- `ENTRA_TENANT_ID`/`ENTRA_CLIENT_ID`/`ENTRA_CLIENT_SECRET`は1つでも設定すると3つとも必須(`scripts/serve-production.mjs`が起動時検証)
- `ENTRA_GROUP_ROLE_MAP`の値も`ACCESS_ROLE_MAP`と同じくROLE_POLICIESに存在するロール名のみ許容。1人が複数のマッピング済みグループへ所属する場合は`cad_admin > approver > reviewer > drafter > viewer`の順で最も権限の強いロールを採用する(`src/api-handler.js`の`ROLE_PRECEDENCE`)
- App Registration側でMicrosoft Graphの**Application permissions**(Delegatedではない)`GroupMember.Read.All`または`Group.Read.All`にテナント管理者のadmin consentが必要
- グループGUIDはEntra管理センターの「グループ」詳細画面の「オブジェクトID」で確認できる
- Client Secretには有効期限がある(登録時に選択。運用チームは2026-08-30時点で6ヶ月以内の期限を設定済み)。期限切れ前にEntra管理センターで再発行し、`production.env`を更新して`systemctl restart mirai-web-cad.service`すること。期限切れ後はEntra解決が失敗し続けるが、fail-softにより`ACCESS_ROLE_MAP`/`ACCESS_DEFAULT_ROLE`へ縮退するだけでサービス全体は停止しない
- Entra解決の失敗(タイムアウト・認証エラー・応答不正)はいずれもログへメールアドレスを出力せずfail-softで`ACCESS_DEFAULT_ROLE`(既定`viewer`)へ縮退する。過大な権限へは決して昇格しない
- グループ所属変更の反映には最大`ENTRA_GROUP_CACHE_TTL_MINUTES`分の遅延がある(インメモリキャッシュ、プロセス再起動で即時クリアされる)

### 3. Migration適用

```bash
source <(grep -v '^#' ~/.config/mirai-web-cad/production.env)
DATABASE_URL="$DATABASE_URL" npm run db:verify
```

### 4. systemdユニット配置

```bash
sudo install -o root -g root -m 0644 \
  deploy/systemd/mirai-web-cad.service \
  deploy/systemd/mirai-web-cad-cloudflared.service \
  deploy/systemd/mirai-web-cad-backup.service \
  deploy/systemd/mirai-web-cad-backup.timer \
  deploy/systemd/mirai-web-cad-backup-check.service \
  deploy/systemd/mirai-web-cad-backup-check.timer \
  /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now mirai-web-cad.service
sudo systemctl enable --now mirai-web-cad-backup.timer mirai-web-cad-backup-check.timer
```

`mirai-web-cad-cloudflared.service`はCloudflare Tunnel作成後に有効化する(下記)。

### 5. Cloudflare Tunnel作成

```bash
cloudflared tunnel list | grep -i mirai-web-cad   # 名前衝突がないことを確認
cloudflared tunnel create mirai-web-cad            # UUIDとcredentials JSONパスが出力される
cp deploy/cloudflared/mirai-web-cad-config.example.yml ~/.cloudflared/mirai-web-cad-config.yml
# ~/.cloudflared/mirai-web-cad-config.yml のtunnel/credentials-fileをUUIDで置換
cloudflared tunnel ingress validate --config ~/.cloudflared/mirai-web-cad-config.yml
sudo systemctl enable --now mirai-web-cad-cloudflared.service
cloudflared tunnel info mirai-web-cad               # コネクタ登録を確認(この時点でDNS未設定・公開影響ゼロ)
```

**DNS route作成(`cloudflared tunnel route dns mirai-web-cad mirai-web-cad.mirai-dx-platform.com`)は高リスク操作。** 既存のCloudflare Pages Custom Domain設定を人間が解除し、DNSレコードの消失を確認した後に、改めてY/N確認のうえ実行すること。詳細は`docs/operations.md`のリリース判定基準を参照。

## 日常運用

### デプロイ(手動)

```bash
source <(grep -v '^#' ~/.config/mirai-web-cad/production.env)
bash scripts/deploy-local.sh
```

`mainブランチをfast-forward → npm ci → build → db:verify → systemctl restart → health確認`を行い、health確認に失敗した場合は直前のコミットへ自動ロールバックする。

### バックアップ

`mirai-web-cad-backup.timer`が毎日03:10(JST、`RandomizedDelaySec=30min`)に`scripts/backup-local.sh`を実行し、`/var/backups/mirai-web-cad/postgres/`へdumpを保存する(保持14日)。`mirai-web-cad-backup-check.timer`が毎日06:00に鮮度(36時間以内・0バイト超)を検証する。

手動実行:

```bash
sudo systemctl start mirai-web-cad-backup.service
sudo systemctl start mirai-web-cad-backup-check.service
journalctl -u mirai-web-cad-backup.service -n 20
```

### ログ確認

```bash
journalctl -u mirai-web-cad.service -f
journalctl -u mirai-web-cad-cloudflared.service -f
```

`scripts/serve-production.mjs`は1行1 JSONの構造化ログをstdoutへ出力する(journaldが収集)。接続文字列・JWT・Cookieはログに出力しない設計。

### ロールバック

```bash
git checkout <直前の正常コミットSHA>
npm ci && npm run build
sudo systemctl restart mirai-web-cad.service
```

Cloudflare Tunnel/DNSに問題がある場合は、Cloudflare Pages Custom Domainを再アタッチする(Pagesプロジェクト・`functions/`・`wrangler.toml`はロールバック手段として当面残置している)。

## Cloudflareエッジキャッシュ(リポジトリ外設定、重要)

2026-08-30、UI更新を本番反映してもブラウザに変化が反映されない障害が発生した(P0-30参照)。原因はCloudflareのZone設定`Browser Cache TTL`が`14400`(4時間、固定値)になっており、`_headers`でオリジンが`/src/*`に`Cache-Control: no-cache, must-revalidate`を送っても、CloudflareがこれをZone設定のTTLで上書きしていたため。

対応として、`mirai-web-cad.mirai-dx-platform.com`ホスト名限定(他サブドメイン非対象)のCache Rule(`http_request_cache_settings`フェーズ、式`(http.host eq "mirai-web-cad.mirai-dx-platform.com" and starts_with(http.request.uri.path, "/src/"))`、アクション`set_cache_settings` / `cache: false`)をCloudflare API経由で追加し、`/src/*`をエッジキャッシュから完全にバイパスするよう設定した。**この設定はGitリポジトリ管理外(Cloudflareダッシュボード/APIのみ)であり、コードやCIから再現できない。** Zoneを作り直す場合や他ホスト名へ切り替える場合は、このCache Ruleを再作成すること。

確認方法:

```bash
curl -sI https://mirai-web-cad.mirai-dx-platform.com/src/app.js | grep -i "cache-control\|cf-cache-status"
# cache-control: no-cache, must-revalidate
# cf-cache-status: DYNAMIC (bypassされていることを示す。HITが出たら要調査)
```

デプロイ後に古いUIが表示される場合の緊急対応(Cache Ruleが機能していない・別途キャッシュ層が挟まった等の異常時のみ):

```bash
# Cloudflare API経由でキャッシュを強制パージ(mcp__cloudflare-api__executeまたはdashboardから)
# 対象: https://mirai-web-cad.mirai-dx-platform.com/ 、/src/app.js 、/src/styles.css 等
```

## 既知の制約

- 本番サービスがこのホスト(kensan1969)の稼働に依存する。ホスト停止・ネットワーク断で本番が停止する
- `mirai-web-cad.service`のsystemdユニットは`IPAddressDeny=any`を採用していない(Cloudflare Access JWKS取得の外向きHTTPSに必要なため)。インバウンド制限は`127.0.0.1`バインドと`RestrictAddressFamilies`で担保している
- CI(GitHub Actions)からはこのホストへ直接デプロイできないため、デプロイは`scripts/deploy-local.sh`の手動実行に依存する。self-hosted runner化は将来の別Issueとする
- バックアップのオフサイト転送(R2等)は未実施。保存先・暗号鍵・保持期間・費用・復元責任者の合意が別途必要
