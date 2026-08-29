# MVP 要件・設計トレーサビリティ

リポジトリ内の企画書、要件定義書、詳細仕様設計書を現Roundで参照できる正本とし、MVP実装との対応を記録します。

最終更新: 2026-08-29(Round 8)。この表はRound 3〜4時点で作成後、寸法/ハッチ/ブロック/レイアウトの追加実装(Round 5〜6)を反映していなかったため、実態と整合するよう更新した。実装レベルの3段階(試作/限定対応/実案件認定済み)は[README](../README.md)の機能表と対応する。

| 正本の要求 | MVP実装 | 検証 | 状態 |
| --- | --- | --- | --- |
| CAD Coreが正、AIは支援 | `cad-core.js`の決定論的Transaction。AIはProposalのみ生成 | Unit/API/E2E | 適合 |
| 作図・編集 | line、rect、circle、polyline、text、move、copy、delete、Undo/Redo | Unit/E2E | MVP適合(限定対応) |
| レイヤー | 表示、現在レイヤー、ロックと変更拒否 | Unit/E2E | MVP適合(限定対応) |
| Command Interface | 画面下部CLIを解析し、`commands[]`を一括適用してbefore/after hashを記録 | Unit/API/E2E | MVP適合(限定対応) |
| 新規作成・Import | 空/デモ図面作成、Mirai JSON、ASCII DXF 2D要素読込(ARCはポリライン変換) | Unit/API/E2E | MVP適合(限定対応) |
| Agent Guardrails | Preview、明示承認、権限再確認、監査 | Unit/API/E2E | 適合 |
| Lifecycleと承認 | draft、in_review、approved、新版。API未接続時はサーバー権限を経由しないローカル完結を行わない(2026-08-29修正) | Unit/API | MVP適合(限定対応) |
| 競合解決 | `expected-version`と`Idempotency-Key` | API/Preview | MVP適合 |
| 正常/空/Loading/Error | State Review切替 | E2E | 適合 |
| Responsive/Keyboard/A11y | desktop/mobile、Escape/Delete、focus、axe | E2E/static | 適合(モバイルはコマンドライン重なり等の既知制約あり) |
| 寸法(DIM)、ハッチ(HATCH)、ブロック(BLOCK) | Round 5〜6で実装(コマンドライン/UI経由)。DIMは2点間簡易寸法のみ、HATCHは境界探索・連想更新なし、BLOCKは1図形をchildrenへ包む簡易構造 | Unit/E2E | MVP適合(試作〜限定対応。AutoCAD/ARES相当の精度・機能ではない) |
| レイアウト・PDF出力 | レイアウト空間タブ、用紙サイズ/縮尺/余白/表題設定を実装。ただしレイアウト空間は実図形を描画せずビューポート文字表示に留まり、印刷は`window.print()`依存 | E2E(画面表示のみ) | 試作 |
| DWG入出力、DXF書出し | 未実装(DXF読込のみ対応) | Gap記録 | MVP後 |

OpenDesignの外部プロジェクトID/URLまたは接続ツールは現環境で確認できません。視覚整合は詳細仕様設計書の画面境界、色、Agent Gateを基準にし、Round 3 Previewのdesktop/mobileスクリーンショットで確認しました。
