import test from "node:test";
import assert from "node:assert/strict";
import { createDrawing } from "../src/cad-core.js";
import { exportDxf } from "../src/dxf-export.js";
import { applyTransaction } from "../src/cad-core.js";
import { parseCadImport } from "../src/importers.js";
import { compareDrawings } from "../src/drawing-compare.js";
import { TOLERANCE_V0, scoreComparison } from "../src/compat-score.js";

function drawingWith(entities, overrides = {}) {
  const drawing = createDrawing({ ...overrides });
  const applied = applyTransaction(drawing, {
    source: "system",
    label: "test-fixture",
    commands: entities.map((entity) => ({ op: "add", entity }))
  });
  assert.equal(applied.ok, true);
  return applied.drawing;
}

test("半径・文字高さが0以下のentityは不正DXFとして出力せずskippedへ報告する", () => {
  const drawing = drawingWith([
    { id: "c1", type: "circle", layerId: "layer-temporary", center: { x: 0, y: 0 }, radius: 0 },
    { id: "c2", type: "circle", layerId: "layer-temporary", center: { x: 0, y: 0 }, radius: -5 },
    { id: "t1", type: "text", layerId: "layer-annotation", at: { x: 0, y: 0 }, value: "高さ0", size: 0 },
    { id: "e1", type: "line", layerId: "layer-structure", points: [{ x: 0, y: 0 }, { x: 10, y: 0 }] }
  ]);
  const result = exportDxf(drawing);
  assert.equal(result.exported, 1);
  assert.deepEqual(
    result.skipped.map((item) => item.type),
    ["circle", "circle", "text"]
  );
  assert.doesNotMatch(result.content, /40\n-?0\b/);
  assert.doesNotMatch(result.content, /\n40\n0\n1\n高さ0\n/);
});

test("DXF書出しはHEADER/TABLES/ENTITIES/EOFを含む最小構成を生成する", () => {
  const drawing = createDrawing();
  const { content } = exportDxf(drawing);
  assert.match(content, /(^|\n)0\nSECTION\n2\nHEADER\n/);
  assert.match(content, /\n0\nSECTION\n2\nTABLES\n/);
  assert.match(content, /\n0\nSECTION\n2\nENTITIES\n/);
  assert.match(content, /(^|\n)0\nEOF$/);
  // 単位mm→INSUNITS=4, m→6
  assert.match(content, /\n9\n\$INSUNITS\n70\n4\n/);
  const meters = exportDxf(createDrawing({ unit: "m" })).content;
  assert.match(meters, /\n9\n\$INSUNITS\n70\n6\n/);
});

test("line/circle/arc/polyline/textが対応entityとしてDXFへ書出される", () => {
  const drawing = drawingWith([
    { id: "e1", type: "line", layerId: "layer-structure", points: [{ x: 10, y: 20 }, { x: 110, y: 120 }] },
    { id: "e2", type: "circle", layerId: "layer-temporary", center: { x: 200, y: 300 }, radius: 25 },
    { id: "e_arc", type: "arc", layerId: "layer-structure", center: { x: 500, y: 600 }, radius: 75, startAngle: -10, endAngle: 380 },
    {
      id: "e3",
      type: "polyline",
      layerId: "layer-center",
      points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 50 }],
      closed: true
    },
    { id: "e4", type: "text", layerId: "layer-annotation", at: { x: 400, y: 500 }, value: "施工注記", size: 240 }
  ]);
  const result = exportDxf(drawing);
  assert.equal(result.exported, 5);
  assert.equal(result.skipped.length, 0);
  const { content } = result;
  assert.match(content, /\n0\nLINE\n8\n構造物\n10\n10\n20\n20\n11\n110\n21\n120\n/);
  assert.match(content, /\n0\nCIRCLE\n8\n仮設\n10\n200\n20\n300\n40\n25\n/);
  assert.match(content, /\n0\nARC\n8\n構造物\n10\n500\n20\n600\n40\n75\n50\n350\n51\n20\n/);
  assert.match(content, /\n0\nLWPOLYLINE\n8\n中心線\n90\n3\n70\n1\n/);
  assert.match(content, /\n0\nTEXT\n8\n注記\n10\n400\n20\n500\n40\n240\n1\n施工注記\n/);
});

test("rectは閉鎖LWPOLYLINE(4頂点)として書出される", () => {
  const drawing = drawingWith([
    { id: "e1", type: "rect", layerId: "layer-structure", origin: { x: 0, y: 0 }, width: 100, height: 50 }
  ]);
  const { content } = exportDxf(drawing);
  assert.match(content, /\n0\nLWPOLYLINE\n8\n構造物\n90\n4\n70\n1\n10\n0\n20\n0\n10\n100\n20\n0\n10\n100\n20\n50\n10\n0\n20\n50\n/);
});

test("dimension/hatch/blockは黙って捨てずskippedへ構造化して報告する", () => {
  const drawing = drawingWith([
    {
      id: "d1",
      type: "dimension",
      layerId: "layer-annotation",
      points: [{ x: 0, y: 0 }, { x: 100, y: 0 }],
      offset: 50
    },
    {
      id: "h1",
      type: "hatch",
      layerId: "layer-structure",
      points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 10 }]
    },
    {
      id: "b1",
      type: "block",
      layerId: "layer-frame",
      name: "TEST",
      insertion: { x: 0, y: 0 },
      children: [{ id: "c1", type: "line", layerId: "layer-frame", points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] }]
    },
    { id: "e1", type: "line", layerId: "layer-structure", points: [{ x: 0, y: 0 }, { x: 10, y: 0 }] }
  ]);
  const result = exportDxf(drawing);
  assert.equal(result.exported, 1);
  assert.deepEqual(
    result.skipped.map((item) => item.type),
    ["dimension", "hatch", "block"]
  );
  assert.ok(result.skipped.every((item) => typeof item.id === "string" && typeof item.reason === "string"));
  assert.doesNotMatch(result.content, /\n0\nDIMENSION\n/);
});

test("存在しないレイヤーを参照するentityはskippedへ報告する", () => {
  const drawing = createDrawing();
  // applyTransactionは存在しないレイヤーの追加を拒否するため、storage由来の不正データ相当を直接注入する
  drawing.entities = [{ id: "e1", type: "line", layerId: "no-such-layer", points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] }];
  const result = exportDxf(drawing);
  assert.equal(result.exported, 0);
  assert.equal(result.skipped.length, 1);
  assert.equal(result.skipped[0].type, "line");
  assert.match(result.skipped[0].reason, /レイヤー/);
});

test("改行を含むtextは空白へ変換しwarningへ記録する", () => {
  const drawing = drawingWith([
    { id: "e1", type: "text", layerId: "layer-annotation", at: { x: 0, y: 0 }, value: "1行目\n2行目", size: 180 }
  ]);
  const result = exportDxf(drawing);
  assert.equal(result.exported, 1);
  assert.equal(result.warnings.length, 1);
  assert.doesNotMatch(result.content, /1行目\n2行目/);
  assert.match(result.content, /1行目 2行目/);
});

test("レイヤ色は近傍ACIへ近似される(赤→1、白→7)", () => {
  const red = createDrawing();
  red.layers[0].color = "#ff0000";
  assert.match(exportDxf(red).content, /\n0\nLAYER\n2\n図枠\n70\n0\n62\n1\n/);
  const white = createDrawing();
  white.layers[0].color = "#ffffff";
  assert.match(exportDxf(white).content, /\n0\nLAYER\n2\n図枠\n70\n0\n62\n7\n/);
});

test("書出したDXFを再importすると対応entityは幾何一致で往復する", () => {
  // 往復比較の想定: DXF→import(内部モデル)→export→import が、座標・層・文字・閉鎖状態を
  // 保持することを比較器(compareDrawings)の9軸採点で確認する。
  const sourceDxf = [
    "0", "SECTION", "2", "ENTITIES",
    "0", "LINE", "8", "DXF-LINE", "10", "10", "20", "20", "11", "110", "21", "120",
    "0", "CIRCLE", "8", "DXF-CIRCLE", "10", "200", "20", "300", "40", "25",
    "0", "ARC", "8", "DXF-ARC", "10", "250", "20", "350", "40", "50", "50", "350", "51", "20",
    "0", "LWPOLYLINE", "8", "DXF-PLINE", "90", "3", "70", "1",
    "10", "0", "20", "0", "10", "100", "20", "0", "10", "100", "20", "50",
    "0", "TEXT", "8", "DXF-TEXT", "10", "400", "20", "500", "40", "240", "1", "R100 施工",
    "0", "ENDSEC", "0", "EOF"
  ].join("\n");

  const base = createDrawing();
  const first = parseCadImport({ filename: "source.dxf", content: sourceDxf, drawing: base, currentLayerId: base.layers[0].id });
  const firstDrawing = applyTransaction(base, { source: "system", label: "first-import", commands: first.commands }).drawing;

  const exported = exportDxf(firstDrawing);
  assert.equal(exported.skipped.length, 0);

  const base2 = createDrawing();
  const second = parseCadImport({ filename: "roundtrip.dxf", content: exported.content, drawing: base2, currentLayerId: base2.layers[0].id });
  const secondDrawing = applyTransaction(base2, { source: "system", label: "second-import", commands: second.commands }).drawing;

  const report = compareDrawings(firstDrawing, secondDrawing, TOLERANCE_V0, { mode: "dxf-roundtrip" });
  const scored = scoreComparison(report);
  assert.equal(report.totals.missing, 0);
  assert.equal(report.totals.extra, 0);
  assert.equal(scored.criticalCount, 0);
  assert.ok(scored.score >= 0.95, `score=${scored.score}`);
});

test("座標は指数表記や余分な小数を含まず1e-9単位へ丸めて書出される", () => {
  const drawing = drawingWith([
    { id: "e1", type: "line", layerId: "layer-structure", points: [{ x: 0.1 + 0.2, y: 1e-10 }, { x: 12000.123456789, y: -0.0000000004 }] }
  ]);
  const { content } = exportDxf(drawing);
  assert.doesNotMatch(content, /e[+-]?\d+/);
  assert.match(content, /\n10\n0\.3\n20\n0\n/);
  assert.match(content, /\n11\n12000\.123456789\n21\n0\n/);
});
