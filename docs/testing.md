# テスト方針

## Gate

| Gate | コマンド | 主な検査 |
| --- | --- | --- |
| Lint | `npm run lint` | 必須成果物、JavaScript構文、未解決マーカー |
| Type | `npm run typecheck` | `checkJs`によるUI、CAD Core、API、Neon層の型整合 |
| Unit/API | `npm test` | CAD不変条件、権限、Access JWT、Idempotency、AI承認 |
| A11y static | `npm run a11y` | lang、ARIA、focus-visible、Responsive規則 |
| Build | `npm run build` | Cloudflare Pages配信物生成 |
| E2E | `npm run test:e2e` | desktop/mobile UI、Canvas非空、API同期、作図、AI承認、Keyboard、axe |
| DB | `npm run db:verify` | 空PostgreSQLへMigration/Seedを2回適用 |
| Secret | GitHub Actions | Gitleaksで`Mirai-Web-CAD`を走査 |

`npm run verify`はDB以外のローカルGateを一括実行します。DB検証は`DATABASE_URL`を明示した隔離DB、CIではPostgreSQL service containerを使用します。

## Preview E2E

```bash
E2E_BASE_URL=https://mvp-round-4.mirai-web-cad.pages.dev npm run test:e2e
```

正常、空、Loading、Error、viewer拒否、Escapeキー、狭幅レイアウト、axe Critical/Serious 0件をdesktop/mobile Chromiumで確認します。AI変更はPreview表示後の明示承認でのみ適用します。
