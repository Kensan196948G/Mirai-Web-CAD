import test from "node:test";
import assert from "node:assert/strict";
import { applyTransaction, createDrawing } from "../src/cad-core.js";
import { dimensionEntity, hatchEntity, transformEntity } from "../src/cad-advanced.js";
import { exportDxf } from "../src/dxf-export.js";
import { parseCadImport } from "../src/importers.js";
import { nativeBlockDrawing } from "./fixtures/native-block.js";

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

test("transformEntityはHATCHのelevation x/yを変換せず、Zのみ倍率換算する", () => {
  const drawing = createDrawing();
  const hatch = hatchEntity(drawing.layers[0].id, [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }]);
  hatch.elevation = { x: 0, y: 0, z: 5 };
  // DXF仕様上、HATCHのelevation pointはx/yが常に0でZのみが標高。平行移動・回転の
  // 影響を受けてはならない(受けると原本へ仕様違反の値を書き戻してしまう)。
  assert.deepEqual(transformEntity(hatch, { dx: 100, dy: 200, angle: 45 }).elevation, { x: 0, y: 0, z: 5 });
  // 単位変換などの倍率変更ではZは一貫して換算する。
  assert.deepEqual(transformEntity(hatch, { scale: 1000 }).elevation, { x: 0, y: 0, z: 5000 });
});

test("原本パッチでHATCHを移動してもelevation pointのgroup 10/20は0を保つ", () => {
  const { drawing } = importDxf(nativeFixture);
  const hatch = drawing.entities.find((entity) => entity.type === "hatch");
  const moved = applyTransaction(drawing, { source: "system", label: "native-move",
    commands: [{ op: "update", id: hatch.id, patch: transformEntity(hatch, { dx: 7, dy: 9 }) }] });
  assert.equal(moved.ok, true, moved.error);
  const exported = exportDxf(moved.drawing);
  assert.equal(exported.preservation?.mode, "source-patch", "この編集は原本パッチで処理されるはず");

  const lines = exported.content.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.length > 0);
  const start = lines.findIndex((value, index) => value === "0" && lines[index + 1] === "HATCH");
  assert.ok(start >= 0, "HATCHレコードが出力される");
  const groups = [];
  for (let index = start; index + 1 < lines.length && (groups.length === 0 || lines[index] !== "0"); index += 2) groups.push([lines[index], lines[index + 1]]);
  const code10 = groups.filter(([code]) => code === "10").map(([, value]) => value);
  const code20 = groups.filter(([code]) => code === "20").map(([, value]) => value);
  // 1件目はelevation point(OCS標高点)で、DXF仕様上つねに0でなければならない。
  assert.equal(code10[0], "0", "HATCH elevation pointのX(group 10)は移動後も0を保つ");
  assert.equal(code20[0], "0", "HATCH elevation pointのY(group 20)は移動後も0を保つ");
  // 2件目は境界edge(円弧中心)、3件目はseed pointで、いずれも平行移動へ追従する。
  assert.deepEqual(code10.slice(1), ["27", "27"], "境界とseed pointは平行移動へ追従する");
  assert.deepEqual(code20.slice(1), ["29", "29"], "境界とseed pointは平行移動へ追従する");
  assert.deepEqual(importDxf(exported.content).drawing.entities.find((entity) => entity.type === "hatch").elevation, { x: 0, y: 0, z: 0 });
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

test("原本パッチ経路でもHATCHのelevation.zが書き戻され、往復で失われない", () => {
  const elevated = nativeFixture.replace("\n30\n0\n210", "\n30\n15\n210");
  assert.notEqual(elevated, nativeFixture, "フィクスチャのHATCH elevation.zを15へ差替えられる");
  const { drawing } = importDxf(elevated);
  const hatch = drawing.entities.find((entity) => entity.type === "hatch");
  assert.equal(hatch.elevation.z, 15);
  const scaled = applyTransaction(drawing, { source: "system", label: "native-scale",
    commands: [{ op: "update", id: hatch.id, patch: transformEntity(hatch, { scale: 2, base: { x: 0, y: 0 } }) }] });
  assert.equal(scaled.ok, true, scaled.error);
  const exported = exportDxf(scaled.drawing);
  assert.equal(exported.preservation?.mode, "source-patch", "この編集は原本パッチで処理されるはず");
  const lines = exported.content.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.length > 0);
  const start = lines.findIndex((value, index) => value === "0" && lines[index + 1] === "HATCH");
  assert.ok(start >= 0, "HATCHレコードが出力される");
  const groups = [];
  for (let index = start; index + 1 < lines.length && (groups.length === 0 || lines[index] !== "0"); index += 2) groups.push([lines[index], lines[index + 1]]);
  assert.deepEqual(groups.filter(([code]) => code === "30").map(([, value]) => value), ["30"], "elevation.zがgroup 30へ書き戻される");
  assert.equal(importDxf(exported.content).drawing.entities.find((entity) => entity.type === "hatch").elevation.z, 30);
});

test("VIEWPORTのsnapBase/snapSpacing/gridSpacingが原本なしの書出しでも失われない", () => {
  const drawing = createDrawing();
  const viewport = { id: "vp-snap", type: "viewport", layerId: drawing.layers[0].id, center: { x: 200, y: 150 }, width: 180, height: 100,
    viewCenter: { x: 50, y: 60 }, snapBase: { x: 5, y: 6 }, snapSpacing: { x: 10, y: 11 }, gridSpacing: { x: 20, y: 21 },
    viewTarget: { x: 0, y: 0, z: 0 }, viewDirection: { x: 0, y: 0, z: 1 }, viewHeight: 100, status: 2, viewportId: 2, flags: 0, locked: false,
    paperSpace: true, layoutName: "Layout1", style: { strokeWidth: 1, lineDash: [], fill: "transparent" }, meta: {} };
  const added = applyTransaction(drawing, { source: "system", commands: [{ op: "add", entity: viewport }] });
  assert.equal(added.ok, true, added.error);
  const exported = exportDxf(added.drawing);
  assert.equal(exported.skipped.length, 0);
  for (const [code, value] of [["13", "5"], ["23", "6"], ["14", "10"], ["24", "11"], ["15", "20"], ["25", "21"]]) {
    assert.match(exported.content, new RegExp(`\\n${code}\\n${value}\\n`), `VIEWPORTのgroup ${code}が出力される`);
  }
  const reimported = importDxf(exported.content).drawing.entities.find((entity) => entity.type === "viewport");
  assert.deepEqual(reimported.snapBase, { x: 5, y: 6 });
  assert.deepEqual(reimported.snapSpacing, { x: 10, y: 11 });
  assert.deepEqual(reimported.gridSpacing, { x: 20, y: 21 });
});

test("INSERTを含むDXFでもelevation付きHATCHを取込める(group 30は3D座標ではない)", () => {
  const base = exportDxf(nativeBlockDrawing()).content;
  const marker = "\n0\nENDSEC\n0\nEOF";
  assert.ok(base.includes(marker), "ENTITIES末尾のマーカーが見つかる");
  const hatchLines = ["0", "HATCH", "5", "77", "8", "0", "10", "0", "20", "0", "30", "15", "210", "0", "220", "0", "230", "1",
    "2", "SOLID", "70", "1", "71", "0", "91", "1", "92", "3", "72", "0", "73", "1", "93", "3",
    "10", "0", "20", "0", "10", "100", "20", "0", "10", "100", "20", "50", "97", "0",
    "75", "0", "76", "1", "52", "0", "41", "1", "77", "0", "98", "0"];
  const content = base.replace(marker, `\n${hatchLines.join("\n")}${marker}`);
  assert.notEqual(content, base, "ENTITIESへHATCHを追加できる");
  const { drawing } = importDxf(content);
  const hatch = drawing.entities.find((entity) => entity.type === "hatch");
  assert.ok(hatch, "INSERTを含むDXFでもHATCHが取込まれる");
  assert.equal(hatch.elevation.z, 15, "HATCHの標高はgroup 30として保持される");
  assert.deepEqual(hatch.points, [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 50 }]);
});

test("角度線定義点を持たないangular寸法は縮退出力せずスキップ理由付きで報告する", () => {
  const drawing = createDrawing();
  const dimension = { ...dimensionEntity(drawing.layers[0].id, { x: 0, y: 0 }, { x: 100, y: 0 }, { offset: 20 }), dimensionType: "angular" };
  const added = applyTransaction(drawing, { source: "system", commands: [{ op: "add", entity: dimension }] });
  assert.equal(added.ok, true, added.error);
  const exported = exportDxf(added.drawing);
  assert.equal(exported.exported, 0, "縮退した角度寸法を書出してはならない");
  assert.equal(exported.skipped.length, 1);
  assert.match(exported.skipped[0].reason, /角度寸法の角度線定義点/);
  assert.doesNotMatch(exported.content, /\n0\nDIMENSION\n/);
});
