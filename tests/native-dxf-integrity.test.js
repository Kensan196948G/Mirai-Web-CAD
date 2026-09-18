import test from "node:test";
import assert from "node:assert/strict";
import { applyTransaction, createDrawing, entityLength } from "../src/cad-core.js";
import { dimensionEntity, hatchEntity, transformEntity } from "../src/cad-advanced.js";
import { dimensionGeometry } from "../src/cad-dimension.js";
import { exportDxf } from "../src/dxf-export.js";
import { parseCadImport } from "../src/importers.js";

// CodeRabbitレビュー(PR #87)で指摘された、ネイティブDXF入出力まわりの実バグの回帰テスト。
// いずれも「黙って誤った値を出す/値を失う」型の欠陥で、修正前はすべて失敗する。

test("HATCHの周長は全ての境界(穴を含む)を合算する", () => {
  const outer = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }];
  const hole = [{ x: 20, y: 20 }, { x: 40, y: 20 }, { x: 40, y: 40 }, { x: 20, y: 40 }];
  const hatch = { id: "h", type: "hatch", layerId: "l", points: outer, boundaries: [{ points: outer }, { points: hole }] };
  // 400(外周) + 80(穴) = 480。entity.pointsだけを見ると穴の80が抜ける。
  assert.equal(entityLength(hatch), 480);
  assert.equal(entityLength({ ...hatch, boundaries: undefined }), 400, "boundariesを持たない旧データはentity.pointsのみで計算する");
});

test("3点角度寸法(type 5)はgroup 15を頂点として角度を測る", () => {
  const entity = {
    id: "dim3", type: "dimension", layerId: "l", dimensionType: "angular",
    points: [{ x: 100, y: 0 }, { x: 0, y: 100 }],
    // DXF 3点角度: 15=頂点、13と14が各延長線上の点
    definitionPoints: { "13": { x: 100, y: 0 }, "14": { x: 0, y: 100 }, "15": { x: 0, y: 0 } },
    dxfDimensionType: 5,
    dimensionLinePoint: { x: 50, y: 50 },
    offset: 0, precision: 0, textSize: 180, arrowSize: 120, measurementScale: 1
  };
  const geometry = dimensionGeometry(entity);
  // 頂点(0,0)から+Xと+Yへ伸びる2辺のなす角は90度。type 2として交差計算すると
  // (15→16が縮退するため)異なる値になる。
  assert.equal(Math.round(geometry.value), 90);
  assert.equal(geometry.label, "90");
});

test("角度寸法の返却値にもmeasurementScaleを適用する", () => {
  const entity = {
    id: "dim3s", type: "dimension", layerId: "l", dimensionType: "angular",
    points: [{ x: 100, y: 0 }, { x: 0, y: 100 }],
    definitionPoints: { "13": { x: 100, y: 0 }, "14": { x: 0, y: 100 }, "15": { x: 0, y: 0 } },
    dxfDimensionType: 5, dimensionLinePoint: { x: 50, y: 50 },
    offset: 0, precision: 0, textSize: 180, arrowSize: 120, measurementScale: 2
  };
  const geometry = dimensionGeometry(entity);
  // 他の寸法分岐と同じく、valueはmeasurementScale適用後を返す契約に揃える。
  assert.equal(geometry.value, 180);
  assert.equal(geometry.label, "180");
});

test("座標寸法(ordinate)はAcDbOrdinateDimensionサブクラスで書出す", () => {
  const drawing = createDrawing();
  const dimension = Object.assign(dimensionEntity(drawing.layers[0].id, { x: 10, y: 20 }, { x: 30, y: 40 }, { dimensionType: "ordinate", offset: 0 }), { dxfDimensionType: 6 });
  const added = applyTransaction(drawing, { source: "system", commands: [{ op: "add", entity: dimension }] });
  assert.equal(added.ok, true, added.error);
  const exported = exportDxf(added.drawing);
  assert.equal(exported.skipped.length, 0, exported.skipped.map((item) => item.reason).join(" / "));
  assert.match(exported.content, /\n100\nAcDbOrdinateDimension\n/, "座標寸法は専用サブクラスを出力する");
  assert.doesNotMatch(exported.content, /AcDbRotatedDimension/, "座標寸法を回転寸法のサブクラスで出力しない");
});

test("HATCH境界の非有限値はNaNを出力せずスキップ理由付きで報告する", () => {
  const drawing = createDrawing();
  const hatch = hatchEntity(drawing.layers[0].id, [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }]);
  // 取り込んだDXF由来の境界に非有限値が混ざるケース(検証がないと"NaN"が書出される)
  hatch.boundaries = [{ type: "edges", flags: 1, edges: [{ type: "arc", center: { x: 10, y: 10 }, radius: Number.NaN, startAngle: 0, endAngle: 90, ccw: true }], points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }] }];
  const added = applyTransaction(drawing, { source: "system", commands: [{ op: "add", entity: hatch }] });
  assert.equal(added.ok, true, added.error);
  const exported = exportDxf(added.drawing);
  assert.equal(exported.exported, 0, "不正な境界のHATCHを書出してはならない");
  assert.equal(exported.skipped.length, 1);
  assert.match(exported.skipped[0].reason, /HATCH境界の円弧半径が不正です/);
  assert.doesNotMatch(exported.content, /NaN/);
});

test("必須のgroup codeが欠けたDIMENSION/HATCH/VIEWPORTは0で補わず取込を拒否する", () => {
  const header = ["0", "SECTION", "2", "HEADER", "9", "$ACADVER", "1", "AC1015", "9", "$INSUNITS", "70", "4", "0", "ENDSEC", "0", "SECTION", "2", "ENTITIES"];
  const footer = ["0", "ENDSEC", "0", "EOF"];
  const cases = [
    // VIEWPORT: group 40/41(枠寸法)が欠落 → 幅1×高さ1を黙って作らない
    ["VIEWPORT", ["0", "VIEWPORT", "5", "40", "8", "0", "10", "210", "20", "148", "68", "2", "69", "3", "12", "50", "22", "25", "45", "50"]],
    // HATCH: group 91(境界パス数)が欠落 → 境界の無いHATCHとして扱わない
    ["HATCH", ["0", "HATCH", "5", "41", "8", "0", "10", "0", "20", "0", "30", "0", "2", "SOLID", "70", "1", "92", "3", "72", "0", "73", "1", "93", "3", "10", "0", "20", "0", "10", "100", "20", "0", "10", "100", "20", "50"]],
    // DIMENSION: 定義点13/14が欠落 → 原点の寸法を黙って作らない
    ["DIMENSION", ["0", "DIMENSION", "5", "42", "8", "0", "2", "*D1", "10", "4", "20", "4", "70", "33", "71", "5", "3", "STANDARD"]]
  ];
  for (const [type, record] of cases) {
    const content = [...header, ...record, ...footer].join("\n");
    assert.throws(() => parseCadImport({ filename: "broken.dxf", content, drawing: createDrawing(), currentLayerId: "layer-frame" }),
      /DXF取込を中止しました/, `${type}の必須group欠落を拒否する`);
  }
});

test("VIEWPORTの対話的な回転・尺度変更はモデル空間のカメラ・スナップ設定を変更しない", () => {
  const viewport = {
    id: "vp", type: "viewport", layerId: "l", center: { x: 200, y: 150 }, width: 180, height: 100,
    viewCenter: { x: 50, y: 60 }, snapBase: { x: 5, y: 6 }, snapSpacing: { x: 10, y: 11 }, gridSpacing: { x: 20, y: 21 },
    viewTarget: { x: 0, y: 0, z: 0 }, viewHeight: 100
  };
  // 紙空間のcenterを基準にした回転・尺度変更。モデル空間(DCS)の値は変えてはならない。
  const anchor = { x: viewport.center.x, y: viewport.center.y };
  const rotated = transformEntity(viewport, { angle: 30, base: anchor });
  assert.deepEqual(rotated.viewCenter, viewport.viewCenter, "回転でviewCenterを動かさない");
  assert.deepEqual(rotated.snapBase, viewport.snapBase);
  assert.deepEqual(rotated.snapSpacing, viewport.snapSpacing);
  assert.deepEqual(rotated.gridSpacing, viewport.gridSpacing);
  assert.deepEqual(rotated.viewTarget, viewport.viewTarget);
  assert.equal(rotated.viewHeight, viewport.viewHeight);
  // 枠中心を基準に回すため中心自体は動かないが、原点基準では枠が回る(変換自体は生きている)。
  const rotatedAboutOrigin = transformEntity(viewport, { angle: 30, base: { x: 0, y: 0 } });
  assert.notDeepEqual(rotatedAboutOrigin.center, viewport.center, "紙空間の枠は回転する");
  assert.deepEqual(rotatedAboutOrigin.viewCenter, viewport.viewCenter, "原点基準の回転でもviewCenterを動かさない");

  const scaled = transformEntity(viewport, { scale: 2, base: anchor });
  assert.deepEqual(scaled.viewCenter, viewport.viewCenter, "尺度変更でviewCenterを動かさない");
  assert.deepEqual(scaled.viewTarget, viewport.viewTarget);
  assert.equal(scaled.viewHeight, viewport.viewHeight);
  assert.deepEqual(scaled.center, viewport.center, "枠中心は変わらない");
  assert.equal(scaled.width, viewport.width * 2, "枠寸法は尺度に追従する");
});

test("VIEWPORTの単位変換ではモデル空間のカメラ・スナップ設定も同じ倍率で換算する", () => {
  const viewport = {
    id: "vp", type: "viewport", layerId: "l", center: { x: 200, y: 150 }, width: 180, height: 100,
    viewCenter: { x: 50, y: 60 }, snapBase: { x: 5, y: 6 }, snapSpacing: { x: 10, y: 11 }, gridSpacing: { x: 20, y: 21 },
    viewTarget: { x: 8, y: 9, z: 0 }, viewHeight: 100
  };
  // import-units.jsは { scale: factor }(angle=0・base=原点)で呼ぶ。
  const converted = transformEntity(viewport, { scale: 1000 });
  assert.deepEqual(converted.viewCenter, { x: 50000, y: 60000 });
  assert.deepEqual(converted.snapBase, { x: 5000, y: 6000 });
  assert.deepEqual(converted.snapSpacing, { x: 10000, y: 11000 });
  assert.deepEqual(converted.gridSpacing, { x: 20000, y: 21000 });
  assert.deepEqual(converted.viewTarget, { x: 8000, y: 9000, z: 0 });
  assert.equal(converted.viewHeight, 100000);
});
