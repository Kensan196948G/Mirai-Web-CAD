# Mirai Web CAD

Agentic AIと決定論的な2D CAD Coreを組み合わせた、土木施工図向けWeb CADのMVPです。

GitHub正本は独立リポジトリ`Kensan196948G/Mirai-Web-CAD`です。2026-08-26に`Construction-Enterprise-OS/Mirai-Web-CAD`から履歴を保持して移行しました。

現在のMVPは、ブラウザ単体で次の主要フローを実操作できます。**段階**は実装レベルを示します。「試作」は基本動作するがAutoCAD/ARES相当の精度・堅牢性はなく実案件使用非推奨、「限定対応」は主要ケースで動作するが既知の制約がある、「実案件認定済み」は実案件データでのUAT合格実績がある、を意味します(2026-08-29時点、実案件認定済みは0件)。詳細な制約は[本番運用適合性評価書](docs/production-readiness-assessment.md)を参照してください。

| 領域 | 段階 | 内容 |
| --- | --- | --- |
| 図面作成 | 限定対応 | 空図面/デモ図面の新規作成、図面名、単位（mm/m）。案件・工区管理なし |
| 作図 | 限定対応 | 基本図形、パン・ズーム、移動、複写、回転、尺度、Undo/Redoは動作。TRIM/EXTENDは境界交点でなく線端の座標移動、ポリラインOFFSETは真の平行曲線でなく重心基準の放射移動のため、施工図での精密編集には形状誤差が生じ得る |
| UI | 限定対応 | リボン、モデル/レイアウト空間タブ、タブ式右ドック、ステータスバーは動作。モバイルは固定コマンドラインがCanvasを覆う等、編集用途では未成熟(閲覧・朱書き用途を推奨) |
| 作図補助 | 限定対応 | グリッド表示・スナップ、直交モードは動作。OSnapは端点・頂点・中心のみで、交点・中点・垂線・接線・近接点・トラッキングは未対応 |
| コマンドライン | 限定対応 | 基本作図コマンドは動作。`DIM`は2点間の簡易寸法のみ(角度/半径/直径/公差/連続寸法/寸法スタイル/連想更新は未対応)。`HATCH`は島・境界探索・連想更新なし。`BLOCK`は1図形をchildrenへ包む簡易構造(定義/参照分離、属性、再定義、分解、ライブラリは未対応) |
| Import | 限定対応 | Mirai JSON、ASCII DXFのLINE/CIRCLE/LWPOLYLINE/POLYLINE/ARC/TEXT/MTEXTを読込。ARCはネイティブ円弧でなくポリラインへ変換。DXF書出しは未実装。DWGは対象外です([ADR-0002](docs/adr/ADR-0002-dwg-scope-drop-dxf-only.md)) |
| レイヤー | 限定対応 | 作成、名称・色編集、表示、ロック、現在レイヤー指定、図形のレイヤー変更は動作 |
| プロパティ | 限定対応 | 選択図形の種類・ID確認、レイヤー・線幅編集は動作。選択は単一図形のみで、窓・交差・複数選択は未対応 |
| レイアウト | 試作 | A4～A1、縦横、縮尺、余白、表題の設定は可能だが、レイアウト空間は実図形を描画せずビューポートを示す文字表示に留まる。印刷は`window.print()`依存 |
| AI提案 | 限定対応 | Promptから構造化コマンドを生成し、Canvasへプレビュー後、人の承認で適用。ルールベース(3パターン)を優先し、拾えない場合のみサーバー側プロキシ経由でOpenAI/Anthropicへフォールバックする(2026-08-30〜)。有効化状態は`GET /api/ai/status`で確認可能(鍵は返さない) |
| 検査 | 限定対応 | 重複ID、存在しないレイヤー、用紙外、0長線、円半径、Critical残存を検出。API未接続時は「検査不能」表示に切り替え、承認操作を無効化する(2026-08-29修正) |
| 版/承認 | 限定対応 | 下書き、レビュー提出、承認、承認済み版の直接変更禁止、新版作成は動作。API接続確認(`state.apiStatus.state === "ok"`)が取れている場合のみ操作を許可し、未接続時はサーバー権限を経由しないローカル完結を行わない(2026-08-29修正) |
| 権限 | 限定対応 | 閲覧者、作図者、レビュアー、承認者、CAD管理者の主要操作制御は動作。ロール切替はAPI接続確認後にサーバー実効権限へロックされる |
| 保存 | 限定対応 | LocalStorage自動保存(平文)、JSON出力、デモ初期化。認証済みAPI接続時はローカルPostgreSQLへ同期(2026-08-30〜、Issue #22で移行完了) |
| API | 限定対応 | `/api/health`、図面取得、Transaction、AI Run、承認、監査ログ、重複実行拒否を実装。本番はローカル常駐サーバー(`scripts/serve-production.mjs`)経由でCloudflare Tunnelから配信 |
| 状態確認 | 限定対応 | 正常、空、Loading、Errorを画面内のState Reviewで切替 |
| システム設定 | 限定対応 | 上部設定からグリッド表示、スナップ、間隔、コマンドログ行数をブラウザ単位で保存 |
| DB | 限定対応 | ローカルPostgreSQL 16(このホスト常駐)へ接続し、図面、AI Run、監査、Idempotencyを永続化。2026-08-30にNeon PostgreSQLから移行完了(Issue #22) |

## Preview / 本番

| 用途 | URL | 状態 |
| --- | --- | --- |
| Custom Domain(本番) | `https://mirai-web-cad.mirai-dx-platform.com/` | Cloudflare Tunnel経由でローカル常駐サーバーへ配信。SPAと公開デモは匿名閲覧可。任意図面と全更新APIはCloudflare Access(One-Time PIN、`kensan1969@gmail.com`のみallow、2026-08-30設定)で保護。未認証アクセスはエッジ層で302(Accessログインへのリダイレクト)、アプリ層に到達した場合は401 |
| Cloudflare Pages(参考、ロールバック用) | `https://mirai-web-cad.pages.dev/` | mainマージでは更新されない。SPAのみ200、`/api`は移行前のコードのままで機能しない |

## 起動

```bash
npm run dev
```

`http://localhost:4174` を開きます。ローカルサーバーはSPAと`/api`を同一オリジンで提供します(既定はメモリストア)。

本番相当のサーバー(`scripts/serve-production.mjs`)の詳細は[ローカルデプロイ運用メモ](docs/deployment-local.md)を参照してください。

## 検証

```bash
npm run verify
```

実行内容:

- `npm run lint`: 必須ファイル存在、JS構文、未解決マーカーを検査
- `npm run typecheck`: TypeScriptの`checkJs`でブラウザ/Core/API/DB層を型検査
- `npm run a11y`: lang、viewport、aria、focus-visible、Responsive CSS等を静的検査
- `npm test`: CAD Core、コマンド解析、JSON/DXF Import、公開境界、API認証/権限、JWT fail-closed、Idempotency、原子更新、AI承認を検査
- `npm run build`: `dist/`へ静的配信物を生成
- `npm run test:e2e`: desktop/mobile Chromiumで新規作成、コマンドライン、Undo/Redo、Import、API同期、AI承認、Keyboard、axeを検査

## DB初期化

空のPostgreSQL(ローカルまたは検証用)へ適用する場合:

```bash
DATABASE_URL="postgresql://..." npm run db:verify
```

`db:verify`は`0001_initial.sql`から`0005_audit_log_immutability.sql`と`seeds/demo.sql`を2回適用し、8テーブル、公開デモ属性、Seed重複なし、監査ログの追記専用トリガー(UPDATE/DELETE拒否)を検証します。ローカルPostgreSQL 16での適用を確認済みです。

バックアップ/復元ドリル:

```bash
DATABASE_URL="postgresql://..." BACKUP_FILE="artifacts/cad.dump" npm run db:backup
RESTORE_DATABASE_URL="postgresql://...empty-db" BACKUP_FILE="artifacts/cad.dump" ALLOW_DATABASE_RESTORE=yes npm run db:restore
```

## 主要な受入観点

- CAD CoreがAIから独立し、AIは図面を直接変更しない
- AI変更は追加/削除の影響をプレビューし、人が承認して初めてTransaction化する
- 閲覧者と承認者は作図できず、作図者は承認できない
- レイヤーロックと承認済み版はfail-closedで変更拒否する
- Critical検査項目が残る図面は承認不可
- API更新は`Idempotency-Key`と`expected-version`がない場合に拒否する
- 同じ`Idempotency-Key`の再送は409で拒否し、二重変更を防ぐ
- 本番の`AUTH_MODE=access`ではAccess JWTの署名、issuer、audienceを検証し、ロールはサーバー設定から決定する
- Custom DomainのSPA、health、`visibility=public`のデモ図面は一般公開し、任意図面取得と全更新はfail-closedで拒否する(2026-08-30〜Cloudflare Accessが`/api/*`書込み系を保護。未ログインブラウザ・未認証クライアントはAccessログインへの302、アプリ側の直接fail-closed判定は401)
- 図面、版、最新command event、監査、Idempotency、AI承認状態を単一DB文で確定する
- `main`へのmerge後、`.github/workflows/production.yml`が全検証を実行する(実配信は`scripts/deploy-local.sh`の手動実行、[運用・復旧メモ](docs/operations.md)参照)

## CAD互換範囲

現段階はAutoCAD/Ares Standardの完全互換ではありません。土木施工図向け2D作図、主要幾何編集、寸法、ハッチ、ブロック、レイヤー、レイアウト/PDF印刷(`window.print()`ベース、ベクタ・尺度保証PDFは未実装)を実装しています。**DXF書出しは実装予定です**(80-90%代替方針Phase 1)。**DWGは恒久的に対象外です**([ADR-0002](docs/adr/ADR-0002-dwg-scope-drop-dxf-only.md))。外部参照(XREF)は現Phaseでは未実装です(80-90%代替方針§2.2の90%追加要件、Phase 2で再評価予定)。3D、業界固有アドオンは恒久的に対象外です。対象/限定対応/対象外の詳細な線引きと再校正手順は[代替範囲・採点基準](docs/compat-scope-and-scoring.md)を参照してください。

## 関連文書

- [Roundログ](docs/mvp-round-log.md)
- [運用・復旧メモ](docs/operations.md)
- [ローカルデプロイ運用メモ](docs/deployment-local.md)
- [API/DBメモ](docs/api-db.md)
- [テスト方針](docs/testing.md)
- [要件・設計トレーサビリティ](docs/mvp-traceability.md)
- [本番運用適合性評価書](docs/production-readiness-assessment.md)
- [改善台帳](docs/improvement-register.md)
- [独立リポジトリ移行Manifest](docs/migration-manifest.md)
