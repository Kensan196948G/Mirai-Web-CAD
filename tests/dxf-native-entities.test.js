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
  const commands = drawing.entities.map((entity) => ({ op: "update", id: entity.id, patch: transformEntity(entity, { dx: 7, dy: 9 }) }));
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

test("DIMSTYLE/Layoutモデルの変更を未変更原本として黙って書出さない", () => {
  const { drawing } = importDxf(nativeFixture);
  drawing.dimensionStyles[0].precision = 4;
  const exported = exportDxf(drawing);
  assert.equal(exported.preservation, undefined);
  assert.match(exported.warnings.join(" "), /限定再生成/);
  assert.match(exported.content, /\n271\n4\n/);
});
