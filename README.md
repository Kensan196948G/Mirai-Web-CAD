# Mirai Web CAD

Agentic AIと決定論的な2D CAD Coreを組み合わせた、土木施工図向けWeb CADのMVPです。

現在のMVPは、ブラウザ単体で次の主要フローを実操作できます。

| 領域 | 状態 | 内容 |
| --- | --- | --- |
| 図面作成 | 実装済み | 空図面/デモ図面の新規作成、図面名、単位（mm/m） |
| 作図 | 実装済み | 選択、線、矩形、円、ポリライン、文字、移動、複写、削除、Undo/Redo |
| コマンドライン | 実装済み | `LINE`、`RECT`、`CIRCLE`、`PLINE`、`TEXT`、`ERASE`、`MOVE`、`COPY`、`UNDO`、`REDO`、`SELECT`、`LAYER`、`ZOOM`、`NEW`、`IMPORT` |
| Import | 実装済み | Mirai JSON、ASCII DXFのLINE/CIRCLE/LWPOLYLINE/POLYLINE/ARC/TEXT/MTEXTをCAD Transactionとして読込 |
| レイヤー | 実装済み | 表示切替、ロック、現在レイヤー指定、ロック時の変更拒否 |
| AI提案 | 実装済み | Promptから構造化コマンドを生成し、Canvasへプレビュー後、人の承認で適用 |
| 検査 | 実装済み | 重複ID、存在しないレイヤー、用紙外、0長線、円半径、Critical残存を検出 |
| 版/承認 | 実装済み | 下書き、レビュー提出、承認、承認済み版の直接変更禁止、新版作成 |
| 権限 | 実装済み | 閲覧者、作図者、レビュアー、承認者、CAD管理者の主要操作制御 |
| 保存 | 実装済み | LocalStorage自動保存、JSON出力、デモ初期化。認証済みAPI接続時はNeonへ同期 |
| API | 実装済み | Cloudflare Pages Functionsの`/api/health`、図面取得、Transaction、AI Run、承認、監査ログ、重複実行拒否 |
| 状態確認 | 実装済み | 正常、空、Loading、Errorを画面内のState Reviewで切替 |
| DB | 実装済み | Neon PostgreSQLへ接続し、図面、AI Run、監査、Idempotencyを永続化 |

## Preview

| 用途 | URL | 状態 |
| --- | --- | --- |
| Cloudflare Pages Preview | `https://mvp-round-5.mirai-web-cad.pages.dev/` | 新規作成/CLI/Undo/Redo/Import/UI/API/Responsive/A11y E2E確認済み |
| Custom Domain | `https://mirai-web-cad.mirai-dx-platform.com/` | 本番Deploy済み。SPAはログイン不要で公開200、Worker APIは未認証401 |

## 起動

```bash
npm run dev
```

`http://localhost:4174` を開きます。

ローカルサーバーはSPAと`/api`を同一オリジンで提供します。Cloudflare Pages Functions互換性は次で確認します。

```bash
npm run build
wrangler pages dev dist --port=4176
curl http://127.0.0.1:4176/api/health
```

## 検証

```bash
npm run verify
```

実行内容:

- `npm run lint`: 必須ファイル存在、JS構文、未解決マーカーを検査
- `npm run typecheck`: TypeScriptの`checkJs`でブラウザ/Core/API/DB層を型検査
- `npm run a11y`: lang、viewport、aria、focus-visible、Responsive CSS等を静的検査
- `npm test`: CAD Core、コマンド解析、JSON/DXF Import、API認証/権限、JWT fail-closed、Idempotency、AI承認を検査
- `npm run build`: `dist/`へ静的配信物を生成
- `npm run test:e2e`: desktop/mobile Chromiumで新規作成、コマンドライン、Undo/Redo、Import、API同期、AI承認、Keyboard、axeを検査

## DB初期化

空のNeon PostgreSQLへ適用する場合:

```bash
npm run db:verify
```

`db:verify`は`0001_initial.sql`、`0002_idempotency.sql`、`0003_drawing_revision.sql`、`seeds/demo.sql`を2回適用し、8テーブルとSeed重複なしを検証します。Neonの空DBからの適用とCloudflare Preview接続を確認済みです。

## 主要な受入観点

- CAD CoreがAIから独立し、AIは図面を直接変更しない
- AI変更は追加/削除の影響をプレビューし、人が承認して初めてTransaction化する
- 閲覧者と承認者は作図できず、作図者は承認できない
- レイヤーロックと承認済み版はfail-closedで変更拒否する
- Critical検査項目が残る図面は承認不可
- API更新は`Idempotency-Key`と`expected-version`がない場合に拒否する
- 同じ`Idempotency-Key`の再送は409で拒否し、二重変更を防ぐ
- 本番の`AUTH_MODE=access`ではAccess JWTの署名、issuer、audienceを検証し、ロールはサーバー設定から決定する
- Custom DomainのSPAは一般公開し、未認証ユーザーによるWorker API/Neon更新は401で拒否する
- 既定branchへのmerge後、`.github/workflows/mirai-web-cad-production.yml`が全検証成功時のみPages productionへ配信する

## CAD互換範囲

現段階はAutoCAD/Ares Standardの完全互換ではありません。2D基本作図、主要編集、コマンドライン、JSON/ASCII DXF読込を優先実装しています。DWG、DXF書出し、寸法、ハッチ、ブロック、外部参照、レイアウト/印刷は今後の対象です。

## 関連文書

- [Roundログ](docs/mvp-round-log.md)
- [運用・復旧メモ](docs/operations.md)
- [API/DBメモ](docs/api-db.md)
- [テスト方針](docs/testing.md)
- [要件・設計トレーサビリティ](docs/mvp-traceability.md)
