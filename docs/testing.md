# テスト方針

## Gate

| Gate | コマンド | 主な検査 |
| --- | --- | --- |
| Lint | `npm run lint` | 必須成果物、JavaScript構文、未解決マーカー |
| Type | `npm run typecheck` | `checkJs`によるUI、CAD Core、API、Neon層の型整合 |
| Unit/API | `npm test` | CAD不変条件、CLI、Import、公開/private境界、JWT、RBAC、本文制限、原子更新、AI承認、10k図形Core baseline |
| A11y static | `npm run a11y` | lang、ARIA、focus-visible、Responsive規則 |
| Build | `npm run build` | Cloudflare Pages配信物生成 |
| E2E | `npm run test:e2e` | desktop/mobile UI、新規作成、CLI、Undo/Redo、Import、Canvas、API同期、AI承認、Keyboard、axe |
| DB | `npm run db:verify` | 空PostgreSQLへMigration/Seedを2回適用 |
| Recovery | `npm run db:backup` / `db:restore` | custom archive検証、空DB復元、主要件数確認 |
| Secret | GitHub Actions | Gitleaksで`Mirai-Web-CAD`を走査 |

`npm run verify`はDB以外のローカルGateを一括実行します。DB検証は`DATABASE_URL`を明示した隔離DB、CIではPostgreSQL service containerを使用します。

## Preview E2E

```bash
E2E_BASE_URL=https://mvp-round-5.mirai-web-cad.pages.dev npm run test:e2e
```

正常、空、Loading、Error、viewer拒否、新規作成、コマンドライン、Undo/Redo、JSON Import、Escapeキー、狭幅レイアウト、axe Critical/Serious 0件をdesktop/mobile Chromiumで確認します。AI変更はPreview表示後の明示承認でのみ適用します。

## 2026-08-26 本ラウンド証跡

| 検証 | 結果 |
| --- | --- |
| `npm run verify:fast` | PASS。Lint、Type、static A11y、34 Unit/API/性能baseline、Build |
| PostgreSQL 18空DB | PASS。Migration 0001-0004/Seedを2回適用 |
| Neon Preview原子更新 | PASS。revision 2、audit 2、idempotency 2を別queryで確認後、試験レコード削除 |
| backup/restore drill | PASS。custom archiveを空DBへ復元、projects/drawings/versions/audits各1以上 |
| 未実施 | Production実データbackup/restore、100k図形負荷、障害注入、SSO実利用者E2E |
