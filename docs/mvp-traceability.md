# MVP 要件・設計トレーサビリティ

リポジトリ内の企画書、要件定義書、詳細仕様設計書を現Roundで参照できる正本とし、MVP実装との対応を記録します。

| 正本の要求 | MVP実装 | 検証 | 状態 |
| --- | --- | --- | --- |
| CAD Coreが正、AIは支援 | `cad-core.js`の決定論的Transaction。AIはProposalのみ生成 | Unit/API/E2E | 適合 |
| 作図・編集 | line、rect、circle、polyline、text、move、copy、delete、Undo/Redo | Unit/E2E | MVP適合 |
| レイヤー | 表示、現在レイヤー、ロックと変更拒否 | Unit/E2E | MVP適合 |
| Command Interface | 画面下部CLIを解析し、`commands[]`を一括適用してbefore/after hashを記録 | Unit/API/E2E | MVP適合 |
| 新規作成・Import | 空/デモ図面作成、Mirai JSON、ASCII DXF 2D要素読込 | Unit/API/E2E | MVP適合 |
| Agent Guardrails | Preview、明示承認、権限再確認、監査 | Unit/API/E2E | 適合 |
| Lifecycleと承認 | draft、in_review、approved、新版 | Unit/API | MVP適合 |
| 競合解決 | `expected-version`と`Idempotency-Key` | API/Preview | MVP適合 |
| 正常/空/Loading/Error | State Review切替 | E2E | 適合 |
| Responsive/Keyboard/A11y | desktop/mobile、Escape/Delete、focus、axe | E2E/static | 適合 |
| DWG、DXF書出し、PDF、寸法、ブロック、ハッチ | 未実装 | Gap記録 | MVP後 |

OpenDesignの外部プロジェクトID/URLまたは接続ツールは現環境で確認できません。視覚整合は詳細仕様設計書の画面境界、色、Agent Gateを基準にし、Round 3 Previewのdesktop/mobileスクリーンショットで確認しました。
