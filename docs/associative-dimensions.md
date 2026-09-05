# 連想寸法の実装範囲

2026-09-05。寸法エンジンの第1段階。完全なDimension Engineの完了ではない。

## 対応

- 線分のAligned/水平/垂直寸法、円/円弧の半径/直径寸法。
- 図形IDと点番号/中心/半径の参照を保持し、トランザクション内の全命令を適用した後に再計算。
- 参照切れではCanvasとプロパティを`[?]`にして古い数値を表示しない。検査はcriticalを返し承認を拒否。元IDの復元で再接続。
- 寸法線オフセットのグリップ。連想寸法の定義点は元図形側で編集する。
- 小数0-6桁、文字高さ、矢印寸法、接頭辞/接尾辞、measurementScale。無効値はトランザクション全体を拒否。
- JSON読込では参照IDを輸入先の新IDへ変換し、欠落参照を既存図形へ誤接続しない。COPYで元図形と寸法をまとめて複写すると複写先に参照を付け替える。
- 寸法線の描画・選択・境界を共通演算へ統合。比較器に種類・文字/矢印寸法・接頭辞・尺度の検出を追加。

## 操作

プロパティパネルの操作メニュー、またはCLIを使用する。

```text
DIMASSOC lineId 350
DIMHORIZONTAL lineId 350
DIMVERTICAL lineId 350
DIMRADIUS circleId
DIMDIAMETER circleId
SELECT dimensionId
DIMSTYLE 2 180 120 "L=" "mm"
```

DIMSTYLEは現在選択中の寸法への書式Overrideであり、名前付きスタイル表の管理ではない。
既存DIM/DとDIMALIGNEDは独立Aligned、DIMLINEARは独立水平寸法を作る。単位換算はmeasurementScaleで明示し、図面の単位を推測して変更しない。

## 残件

角度、弧長、座標、累進/並列/連続寸法、公差、矢印形状、補助線設定、名前付きStyleと尺度別注釈、汎用トポロジ参照、Block内参照、複数寸法の配置、DXF DIMENSION往復、PDFの一致試験は後続。独立寸法だけのCOPYや移動による連想寸法の再配置は後続とし、配置変更にはオフセットグリップを使用する。

## 検証

単体で伸縮、命令順序、参照切れ/復旧、検査の非破壊性、半径更新、書式異常、JSON参照付け替え、複写先への参照を検証。desktop/mobile E2EでCLI作成→STRETCH→書式→ERASE→Undoを検証。実案件での寸法受入やDXF/PDF互換を認定するものではない。
