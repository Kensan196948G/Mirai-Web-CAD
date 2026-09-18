# MVP 要件・設計トレーサビリティ

リポジトリ内の企画書、要件定義書、詳細仕様設計書を現Roundで参照できる正本とし、MVP実装との対応を記録します。

最終更新: 2026-09-18(第16回ラウンド)。この表はRound 3〜4時点で作成後、寸法/ハッチ/ブロック/レイアウトの追加実装(Round 5〜6)を反映していなかったため実態と整合させ、さらに2026-09-04〜05の追加実装(ネイティブ円弧/楕円/スプライン、ネイティブBLOCK定義/参照/属性のDXF往復、DXF書出し、案件単位ACL、AIのLLMフォールバック)を反映した。実装レベルの3段階(試作/限定対応/実案件認定済み)は[README](../README.md)の機能表と対応する。**実案件認定済みの機能は無い。**

| 正本の要求 | MVP実装 | 検証 | 状態 |
| --- | --- | --- | --- |
| CAD Coreが正、AIは支援 | `cad-core.js`の決定論的Transaction。AIはProposalのみ生成 | Unit/API/E2E | 適合 |
| 作図・編集 | line、rect、circle、polyline、text、move、copy、delete、Undo/Redo | Unit/E2E | MVP適合(限定対応) |
| レイヤー | 表示、現在レイヤー、ロックと変更拒否 | Unit/E2E | MVP適合(限定対応) |
| Command Interface | 画面下部CLIを解析し、`commands[]`を一括適用してbefore/after hashを記録。未知のopは入力境界で400拒否(2026-09-18) | Unit/API/E2E | MVP適合(限定対応) |
| 新規作成・Import | 空/デモ図面作成、Mirai JSON、ASCII DXF 2D要素読込。**ARC/ELLIPSE/SPLINEはネイティブ図形として保持**しJSON/DXF往復・選択・編集に対応(2026-09-05) | Unit/API/E2E | MVP適合(限定対応) |
| Agent Guardrails | Preview、明示承認、権限再確認、監査 | Unit/API/E2E | 適合 |
| Lifecycleと承認 | draft、in_review、approved、新版。API未接続時はサーバー権限を経由しないローカル完結を行わない(2026-08-29修正) | Unit/API | MVP適合(限定対応) |
| 競合解決 | `expected-version`(10進整数のみ)と`Idempotency-Key`。本文検証後に冪等キーを予約(2026-09-18修正) | API/Preview | MVP適合 |
| 権限・案件ACL | 5ロール(閲覧者/作図者/レビュアー/承認者/CAD管理者)。案件単位の`access_scope`(open/restricted)と`project_members`によるオブジェクトレベルアクセス制御、cad_admin限定の案件管理API(2026-09-18、PR #95) | Unit/API/PostgreSQL統合 | MVP適合(限定対応。案件メンバー管理UIとEntra IDグループ同期は未実装) |
| 正常/空/Loading/Error | State Review切替 | E2E | 適合 |
| Responsive/Keyboard/A11y | desktop/mobile、Escape/Delete、focus、axe | E2E/static | 適合(モバイルはコマンドライン重なり等の既知制約あり) |
| 寸法(DIM)、ハッチ(HATCH)、ブロック(BLOCK) | Round 5〜6で実装(コマンドライン/UI経由)。**BLOCKは2026-09-05に定義/参照/属性とDXF原本保全へ対応**(PR #83〜#86)。DIMは連想の線分/円/円弧寸法等、HATCHは島・境界探索・連想更新なし、レイアウトはビューポート文字表示 | Unit/E2E | MVP適合(試作〜限定対応。AutoCAD/ARES相当の精度・機能ではない) |
| レイアウト・PDF出力 | レイアウト空間タブ、用紙サイズ/縮尺/余白/表題設定を実装。ただしレイアウト空間は実図形を描画せずビューポート文字表示に留まり、印刷は`window.print()`依存(尺度保証ベクタPDFは未実装) | E2E(画面表示のみ) | 試作 |
| DXF書出し | **限定対応**(2026-09-04〜05): ASCII DXF R2000系でline/circle/arc/ellipse/spline/polyline/rect/text+Layersを書出し。dimension/hatch/blockは「黙って捨てず」スキップ理由付きで報告。真色/線種/図枠保持は後続 | Unit/Compat | MVP適合(限定対応) |
| DWG入出力 | **恒久的に対象外**(ADR-0002でDXF単体運用へ確定) | ADR | 対象外 |
| AI提案 | ルールベース(3パターン)を優先し、拾えない場合のみサーバー側プロキシ経由でOpenAI/Anthropicへフォールバック。出力は許可opのホワイトリストと再構築・検証を通過したもののみ適用し、人間承認を必須とする | Unit/API | MVP適合(限定対応。本番の`AI_PROVIDER`は未設定) |

OpenDesignの外部プロジェクトID/URLまたは接続ツールは現環境で確認できません。視覚整合は詳細仕様設計書の画面境界、色、Agent Gateを基準にし、Round 3 Previewのdesktop/mobileスクリーンショットで確認しました。
