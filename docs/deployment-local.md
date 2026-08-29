# ローカルデプロイ運用メモ

2026-08-29〜、本番の永続化先をNeon PostgreSQLからローカルPostgreSQL + Cloudflare Tunnelへ移行する作業を進めている(Issue #22、ユーザー指示による)。**現時点(Phase 1)はコード変更のみが完了しており、systemd配置・Cloudflare Tunnel作成・DNS切替(Phase 2〜3)は未実施のため、実際の本番カットオーバーはまだ行われていない。** 本番は引き続きCloudflare Pages + Neonの構成のまま(Neon認証障害でAPIは機能不全)である。この文書は移行完了後の運用手順、および各Phaseの実施手順を記録する。移行の背景・設計判断は`.claude/plans/`の実装計画、および`docs/operations.md`の該当節を参照。

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

## 既知の制約

- 本番サービスがこのホスト(kensan1969)の稼働に依存する。ホスト停止・ネットワーク断で本番が停止する
- `mirai-web-cad.service`のsystemdユニットは`IPAddressDeny=any`を採用していない(Cloudflare Access JWKS取得の外向きHTTPSに必要なため)。インバウンド制限は`127.0.0.1`バインドと`RestrictAddressFamilies`で担保している
- CI(GitHub Actions)からはこのホストへ直接デプロイできないため、デプロイは`scripts/deploy-local.sh`の手動実行に依存する。self-hosted runner化は将来の別Issueとする
- バックアップのオフサイト転送(R2等)は未実施。保存先・暗号鍵・保持期間・費用・復元責任者の合意が別途必要
