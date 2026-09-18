import test from "node:test";
import assert from "node:assert/strict";
import { applyTransaction, createDrawing } from "../src/cad-core.js";
import { dimensionEntity, hatchEntity, transformEntity } from "../src/cad-advanced.js";
import { exportDxf } from "../src/dxf-export.js";
import { parseCadImport } from "../src/importers.js";

function importDxf(content) {
  const drawing = createDrawing();
  const parsed = parseCadImport({ filename: "native.dxf", content, drawing, currentLayerId: drawing.layers[0].id });
  const applied = applyTransaction(drawing, { source: "system", label: "native-import", commands: parsed.commands });
  assert.equal(applied.ok, true, applied.error);
  return { drawing: applied.drawing, parsed };
}

const nativeFixture = [
  "0", "SECTION", "2", "HEADER", "9", "$ACADVER", "1", "AC1015", "9", "$INSUNITS", "70", "4", "0", "ENDSEC",
  "0", "SECTION", "2", "TABLES", "0", "TABLE", "2", "DIMSTYLE", "70", "1",
  "0", "DIMSTYLE", "105", "20", "2", "CIVIL", "70", "0", "40", "100", "41", "2.5", "140", "2.5", "144", "1", "271", "2", "71", "1", "47", "0.2", "48", "0.1",
  "0", "ENDTAB", "0", "ENDSEC",
  "0", "SECTION", "2", "ENTITIES",
  "0", "DIMENSION", "5", "30", "8", "DIM", "2", "*D1", "10", "4", "20", "4", "11", "5", "21", "5", "13", "0", "23", "0", "14", "10", "24", "0", "15", "0", "25", "0", "16", "0", "26", "10", "70", "34", "71", "5", "1", "<> deg", "3", "CIVIL",
  "0", "HATCH", "5", "31", "8", "HATCH", "10", "0", "20", "0", "30", "0", "210", "0", "220", "0", "230", "1", "2", "SOLID", "70", "1", "71", "1", "91", "1", "92", "1", "93", "1", "72", "2", "10", "20", "20", "20", "40", "10", "50", "0", "51", "360", "73", "1", "97", "1", "330", "99", "75", "0", "76", "1", "52", "0", "41", "1", "77", "0", "98", "1", "10", "20", "20", "20",
  "0", "VIEWPORT", "5", "32", "8", "VIEWPORT", "67", "1", "410", "Sheet-A", "10", "210", "20", "148.5", "40", "180", "41", "100", "68", "2", "69", "3", "12", "50", "22", "25", "16", "0", "26", "0", "36", "1", "17", "0", "27", "0", "37", "0", "45", "50", "51", "15", "90", "16384",
  "0", "ENDSEC",
  "0", "SECTION", "2", "OBJECTS", "0", "LAYOUT", "5", "40", "330", "D", "100", "AcDbPlotSettings", "1", "", "4", "A3", "44", "420", "45", "297", "100", "AcDbLayout", "1", "Sheet-A", "70", "1", "71", "1", "330", "41", "331", "32", "0", "ENDSEC", "0", "EOF"
].join("\n");

test("DIMENSION/HATCH/VIEWPORTとDIMSTYLE/Layoutを原本レコードからネイティブ読込みする", () => {
  const { drawing, parsed } = importDxf(nativeFixture);
  assert.equal(parsed.entityCount, 3);
  assert.deepEqual(drawing.entities.map((entity) => entity.type), ["dimension", "hatch", "viewport"]);
  const [dimension, hatch, viewport] = drawing.entities;
  assert.equal(dimension.dimensionType, "angular");
  assert.equal(dimension.dimensionStyleName, "CIVIL");
  assert.deepEqual(dimension.definitionPoints["16"], { x: 0, y: 10 });
  assert.equal(hatch.associative, true);
  assert.equal(hatch.boundaries[0].edges[0].type, "arc");
  assert.equal(hatch.boundaries[0].sourceHandles[0], "99");
  assert.equal(viewport.layoutName, "Sheet-A");
  assert.equal(viewport.locked, true);
  assert.equal(drawing.dimensionStyles[0].name, "CIVIL");
  assert.equal(drawing.dimensionStyles[0].tolerance, true);
  assert.deepEqual(drawing.dxfLayouts.map((layout) => layout.name), ["Sheet-A"]);
  assert.equal(drawing.dxfLayouts[0].paperWidth, 420);
  assert.equal(exportDxf(drawing).content, nativeFixture);
});

test("ネイティブEntity編集は原本TABLES/OBJECTSを保ったままgroup-codeを局所更新する", () => {
  const { drawing } = importDxf(nativeFixture);
  const commands = drawing.entities.map((entity) => ({ op: "update", id: entity.id,
    patch: { ...transformEntity(entity, { dx: 7, dy: 9 }), ...(entity.type === "viewport" ? { locked: false } : {}) } }));
  const changed = applyTransaction(drawing, { source: "system", label: "native-move", commands });
  assert.equal(changed.ok, true, changed.error);
  const exported = exportDxf(changed.drawing);
  assert.equal(exported.preservation.mode, "source-patch");
  assert.ok(exported.preservation.changedGroups > 0);
  assert.match(exported.content, /\n0\nDIMSTYLE\n/);
  assert.match(exported.content, /\n0\nLAYOUT\n/);
  assert.equal(exported.skipped.length, 0);
  const reimported = importDxf(exported.content).drawing;
  assert.deepEqual(reimported.entities.find((entity) => entity.type === "viewport").center, { x: 217, y: 157.5 });
  assert.equal(reimported.entities.find((entity) => entity.type === "viewport").locked, false);
  assert.deepEqual(reimported.entities.find((entity) => entity.type === "hatch").boundaries[0].edges[0].center, { x: 27, y: 29 });
});

test("原本なしのDIMENSION/HATCH/VIEWPORTをネイティブDXFとして生成して再読込みする", () => {
  const drawing = createDrawing();
  const layerId = drawing.layers[0].id;
  const entities = [
    dimensionEntity(layerId, { x: 0, y: 0 }, { x: 100, y: 0 }, { offset: 20 }),
    hatchEntity(layerId, [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 50 }]),
    { id: "vp-native", type: "viewport", layerId, center: { x: 200, y: 150 }, width: 180, height: 100, viewCenter: { x: 50, y: 50 }, viewTarget: { x: 0, y: 0, z: 0 }, viewDirection: { x: 0, y: 0, z: 1 }, viewHeight: 100, status: 2, viewportId: 2, flags: 16384, locked: true, paperSpace: true, layoutName: "Layout1", style: { strokeWidth: 1, lineDash: [], fill: "transparent" }, meta: {} }
  ];
  const applied = applyTransaction(drawing, { source: "system", commands: entities.map((entity) => ({ op: "add", entity })) });
  assert.equal(applied.ok, true, applied.error);
  const exported = exportDxf(applied.drawing);
  assert.equal(exported.exported, 3);
  assert.equal(exported.skipped.length, 0);
  for (const type of ["DIMENSION", "HATCH", "VIEWPORT"]) assert.match(exported.content, new RegExp(`\\n0\\n${type}\\n`));
  assert.deepEqual(importDxf(exported.content).drawing.entities.map((entity) => entity.type), ["dimension", "hatch", "viewport"]);
});

test("HATCHのelevation.zとseedPointsが原本なし・限定再生成のいずれでも保持される", () => {
  const drawing = createDrawing();
  const layerId = drawing.layers[0].id;
  const hatch = hatchEntity(layerId, [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 50 }]);
  hatch.elevation = { x: 0, y: 0, z: 15 };
  hatch.seedPoints = [{ x: 10, y: 10 }, { x: 20, y: 20 }];
  const added = applyTransaction(drawing, { source: "system", commands: [{ op: "add", entity: hatch }] });
  assert.equal(added.ok, true, added.error);

  // 原本なし(dxfSources無し)の新規生成経路
  const exported = exportDxf(added.drawing);
  assert.match(exported.content, /\n30\n15\n/, "elevation.zがgroup code 30として出力される");
  assert.match(exported.content, /\n98\n2\n/, "seedPoints 2件がgroup code 98件数として出力される");
  const reimported = importDxf(exported.content).drawing.entities.find((entity) => entity.type === "hatch");
  assert.equal(reimported.elevation.z, 15);
  assert.deepEqual(reimported.seedPoints, [{ x: 10, y: 10 }, { x: 20, y: 20 }]);

  // 限定再生成(原本ありだが変更検知でfallbackする)経路
  const reimportedDrawing = importDxf(exported.content).drawing;
  const dimensionStyleChanged = { ...reimportedDrawing, dimensionStyles: [{ ...reimportedDrawing.dimensionStyles[0], precision: 3 }] };
  const regenerated = exportDxf(dimensionStyleChanged);
  assert.equal(regenerated.preservation, undefined, "この変更は限定再生成へフォールバックするはず");
  assert.match(regenerated.content, /\n30\n15\n/, "限定再生成でもelevation.zを出力する");
  assert.match(regenerated.content, /\n98\n2\n/, "限定再生成でもseedPointsを出力する");
});

test("VIEWPORTの紙空間移動はcenterのみ動かし、viewCenter/snapBase/viewTarget(モデル空間のカメラ・スナップ基準)は保持する", () => {
  const viewport = {
    id: "vp-move", type: "viewport", layerId: "layer-structure",
    center: { x: 200, y: 150 }, width: 180, height: 100,
    viewCenter: { x: 50, y: 60 }, snapBase: { x: 5, y: 5 },
    viewTarget: { x: 10, y: 20, z: 3 }, viewDirection: { x: 0, y: 0, z: 1 }, viewHeight: 100
  };
  const moved = transformEntity(viewport, { dx: 7, dy: 9 });
  assert.deepEqual(moved.center, { x: 207, y: 159 }, "紙空間の枠(center)は移動する");
  assert.deepEqual(moved.viewCenter, viewport.viewCenter, "viewCenterはモデル空間の概念であり紙空間の移動で変化しない");
  assert.deepEqual(moved.snapBase, viewport.snapBase, "snapBaseはモデル空間の概念であり紙空間の移動で変化しない");
  assert.deepEqual(moved.viewTarget, viewport.viewTarget, "viewTarget(zを含む)はモデル空間の概念であり紙空間の移動で変化しない");

  // 単位変換等のscale-onlyな全体変換では、モデル空間座標も一貫して換算されるべき
  const scaled = transformEntity(viewport, { scale: 2 });
  assert.deepEqual(scaled.viewCenter, { x: 100, y: 120 }, "scale-onlyの全体変換ではviewCenterも換算される");
  assert.equal(scaled.viewTarget.z, 3, "viewTarget.zは2D変換の対象外のまま保持される");
});

test("非angular寸法のpoints変更を検出し、限定パッチではなく再生成へフォールバックする", () => {
  const drawing = createDrawing();
  const layerId = drawing.layers[0].id;
  const dimension = dimensionEntity(layerId, { x: 0, y: 0 }, { x: 100, y: 0 }, { offset: 20 });
  const added = applyTransaction(drawing, { source: "system", commands: [{ op: "add", entity: dimension }] });
  assert.equal(added.ok, true, added.error);
  const exportedFirst = exportDxf(added.drawing);
  const reimported = importDxf(exportedFirst.content).drawing;
  const importedDimension = reimported.entities.find((entity) => entity.type === "dimension");
  assert.equal(importedDimension.dimensionType, "aligned");

  // 参照解除・グリップ編集等でpointsだけが変化し、dimensionLinePoint/textPoint/
  // definitionPointsは追従しないシナリオを再現する。
  const moved = applyTransaction(reimported, { source: "system", commands: [
    { op: "update", id: importedDimension.id, patch: { points: [{ x: 0, y: 30 }, { x: 100, y: 30 }] } }
  ] });
  assert.equal(moved.ok, true, moved.error);
  const exportedSecond = exportDxf(moved.drawing);
  assert.notEqual(exportedSecond.preservation?.mode, "source-patch", "pointsのみの変更を限定パッチで見逃してはならない");
  const reexported = importDxf(exportedSecond.content).drawing.entities.find((entity) => entity.type === "dimension");
  assert.deepEqual(reexported.points, [{ x: 0, y: 30 }, { x: 100, y: 30 }], "再生成後のDXFは新しいpointsを反映する");
});

const multiLayoutFixture = [
  "0", "SECTION", "2", "HEADER", "9", "$ACADVER", "1", "AC1015", "9", "$INSUNITS", "70", "4", "0", "ENDSEC",
  "0", "SECTION", "2", "ENTITIES",
  // group 410(レイアウトタブ名)を持たないpaper-space HATCH。所有ハンドル330はSheet-Bの
  // BLOCK_RECORDハンドル(51)を指す。410が無いため、330→LAYOUT解決に頼るしかない。
  "0", "HATCH", "5", "60", "330", "51", "8", "HATCH", "67", "1", "10", "0", "20", "0", "30", "0", "210", "0", "220", "0", "230", "1",
  "2", "SOLID", "70", "1", "71", "0", "91", "1", "92", "1", "93", "1", "72", "2", "10", "20", "20", "20", "40", "10", "50", "0", "51", "360", "73", "1", "97", "0", "75", "0", "76", "1", "52", "0", "41", "1", "77", "0", "98", "0",
  "0", "ENDSEC",
  "0", "SECTION", "2", "OBJECTS",
  "0", "LAYOUT", "5", "40", "330", "D", "100", "AcDbPlotSettings", "1", "", "4", "A3", "44", "420", "45", "297", "100", "AcDbLayout", "1", "Sheet-A", "70", "1", "71", "1", "330", "41", "331", "32",
  "0", "LAYOUT", "5", "45", "330", "D", "100", "AcDbPlotSettings", "1", "", "4", "A3", "44", "420", "45", "297", "100", "AcDbLayout", "1", "Sheet-B", "70", "1", "71", "2", "330", "51", "331", "52",
  "0", "ENDSEC", "0", "EOF"
].join("\n");

test("410を持たないEntityのlayoutNameを330所有ハンドル経由でLAYOUTから解決する(複数レイアウト)", () => {
  const { drawing } = importDxf(multiLayoutFixture);
  const hatch = drawing.entities.find((entity) => entity.type === "hatch");
  assert.equal(hatch.paperSpace, true);
  assert.equal(hatch.layoutName, "Sheet-B", "固定の'Layout1'ではなく、330が指すBLOCK_RECORDが属するSheet-Bへ正しく解決されるべき");
});

test("DIMSTYLE/Layoutモデルの変更を未変更原本として黙って書出さない", () => {
  const { drawing } = importDxf(nativeFixture);
  drawing.dimensionStyles[0].precision = 4;
  const exported = exportDxf(drawing);
  assert.equal(exported.preservation, undefined);
  assert.match(exported.warnings.join(" "), /限定再生成/);
  assert.match(exported.content, /\n271\n4\n/);
  // 限定再生成では原本のTABLES/OBJECTSを保持しないため、原本の330/331ハンドル参照
  // (HATCH boundaryのsourceHandles、VIEWPORTのfrozenLayerHandles)は解決不能になる。
  // 無効な参照を出力してはならない(HATCHの関連付け71も0へ落とす)。
  assert.doesNotMatch(exported.content, /\n330\n99\n/, "限定再生成でHATCHの原本sourceHandle参照(330)を出力してはならない");
  assert.doesNotMatch(exported.content, /\n331\n32\n/, "限定再生成でVIEWPORTの原本frozenLayerHandle参照(331)を出力してはならない");
  const hatchSection = exported.content.slice(exported.content.indexOf("\nHATCH\n"));
  assert.match(hatchSection, /\n71\n0\n/, "限定再生成ではHATCHの関連付け(71)を0にする");
});
