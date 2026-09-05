import test from "node:test";
import assert from "node:assert/strict";
import { createDrawing, applyTransaction, entityBounds, hitTest } from "../src/cad-core.js";
import { resolveBlocks } from "../src/cad-block.js";
import { transformEntity, mirrorEntity } from "../src/cad-advanced.js";
import { exportDxf } from "../src/dxf-export.js";
import { parseCadImport } from "../src/importers.js";
import { inspectDxfBlocks, createDxfSourceDocument } from "../src/dxf-source-document.js";
import { nativeBlockDrawing } from "./fixtures/native-block.js";
import { compareDrawings } from "../src/drawing-compare.js";
import { TOLERANCE_V0 } from "../src/compat-score.js";

const importDrawing = (content, filename = "test.dxf") => {
  const drawing = createDrawing();
  const imported = parseCadImport({ filename, content, drawing, currentLayerId: drawing.layers[0].id });
  const result = applyTransaction(drawing, { commands: imported.commands });
  assert.equal(result.ok, true, result.error);
  return result.drawing;
};

test("native blocks share definitions; base point, nested bounds and zero layer inheritance resolve", () => {
  const drawing = nativeBlockDrawing();
  const reference = drawing.entities[1];
  assert.deepEqual(reference.children[0].points, [{ x: 0, y: 0 }, { x: 100, y: 0 }]);
  assert.equal(reference.children[0].layerId, reference.layerId);
  const bounds = entityBounds(reference);
  assert.equal(bounds.minX, 1000);
  assert.equal(bounds.maxX, 1100);
  assert.equal(hitTest(drawing, { x: 1000, y: 500 }, 5)?.id, reference.id);
  reference.children.length = 0;
  resolveBlocks(drawing);
  assert.equal(reference.children.length, 4);
  assert.equal(drawing.blockDefinitions[0].entities[0].points[0].x, 10);
});

test("native DXF contains definitions, nested INSERT and ordered attributes with matching transforms", () => {
  const drawing = nativeBlockDrawing();
  const exported = exportDxf(drawing);
  assert.equal(exported.skipped.length, 0);
  assert.match(exported.content, /AcDbBlockTableRecord/);
  assert.doesNotMatch(exported.content, /[^\x00-\x7f]/);
  const imported = importDrawing(exported.content);
  assert.equal(imported.blockDefinitions.length, 2);
  assert.equal(imported.dxfSources[0].source, exported.content);
  assert.equal(imported.entities[0].rotation, 30);
  assert.equal(imported.entities[0].scale, 2);
  assert.deepEqual(imported.entities[1].attributeReferences.map((a) => a.value), ["測点A", "測点B"]);
  assert.equal(imported.entities[1].children[0].points[0].x, 0);
  assert.deepEqual(imported.blockDefinitions.find((d) => d.name === "INNER").basePoint, { x: 10, y: 20 });
});

test("MOVE/COPY/ROTATE/SCALE and attribute edits survive export and JSON reload", () => {
  let drawing = importDrawing(exportDxf(nativeBlockDrawing()).content);
  const original = drawing.entities[1];
  const changed = transformEntity(original, { dx: 150, dy: 200, angle: 90, scale: 2 });
  changed.attributeReferences[0].value = "変更済";
  const result = applyTransaction(drawing, { commands: [{ op: "update", id: original.id, patch: changed }, { op: "add", entity: { ...changed, id: "copy" } }] });
  assert.equal(result.ok, true, result.error);
  drawing = result.drawing;
  const reloaded = importDrawing(JSON.stringify(drawing), "test.json");
  assert.equal(reloaded.blockDefinitions.length, 2);
  assert.equal(reloaded.dxfSources[0].source, drawing.dxfSources[0].source);
  const output = exportDxf(reloaded);
  const imported = importDrawing(output.content);
  assert.ok(Math.hypot(imported.entities[1].insertion.x - changed.insertion.x, imported.entities[1].insertion.y - changed.insertion.y) < 1e-8);
  assert.equal(imported.entities[1].rotation, 90);
  assert.equal(imported.entities[1].scale, 2);
  assert.deepEqual(imported.entities[1].attributeReferences.map((a) => a.value), ["変更済", "測点B"]);
  assert.equal(imported.entities[1].definitionId, imported.entities[2].definitionId);
  assert.match(output.warnings.join(" "), /TABLES・OBJECTS/);
  const sourceView = inspectDxfBlocks(createDxfSourceDocument(output.content));
  assert.equal(sourceView.references.at(-1).attributes[0].value, "\\U+5909\\U+66F4\\U+6E08");
});

test("definition replacement refreshes every instance atomically; invalid/cyclic/missing references fail", () => {
  const drawing = nativeBlockDrawing();
  const definitions = structuredClone(drawing.blockDefinitions);
  definitions[0].entities[0].points[1].x = 210;
  const transaction = { commands: [{ op: "set_block_resources", definitions, sources: [] }] };
  const result = applyTransaction(drawing, transaction);
  assert.equal(result.ok, true, result.error);
  assert.equal(result.drawing.entities[1].children[0].points[1].x, 200);
  assert.equal(result.drawing.entities[0].children[0].children[0].points[1].x, 200);
  definitions[1].entities[0].definitionId = "outer";
  assert.equal(applyTransaction(drawing, transaction).ok, false);
  assert.equal(drawing.entities[1].children[0].points[1].x, 100);
  assert.equal(applyTransaction(drawing, { commands: [{ op: "update", id: "inner-ref", patch: { definitionId: "missing" } }] }).ok, false);
  assert.equal(applyTransaction(drawing, { commands: [{ op: "update", id: "inner-ref", patch: { scale: -1 } }] }).ok, false);
  assert.throws(() => mirrorEntity(drawing.entities[0], { x: 0, y: 0 }, { x: 1, y: 0 }), /未対応/);
});

test("nonuniform, missing INSERT definitions, unsupported child geometry and resource overflow fail without mutation", () => {
  const content = exportDxf(nativeBlockDrawing()).content;
  const drawing = createDrawing();
  const before = structuredClone(drawing);
  for (const source of [content.replace("42\n2", "42\n3"), content.replace("2\nINNER\n10", "2\nMISSING\n10"), content.replace("0\nCIRCLE", "0\nHATCH")]) {
    assert.throws(() => parseCadImport({ filename: "bad.dxf", content: source, drawing, currentLayerId: drawing.layers[0].id }));
    assert.deepEqual(drawing, before);
  }
  const result = applyTransaction(drawing, { commands: [{ op: "set_block_resources", definitions: [], sources: [{ source: "x".repeat(710000) }] }] });
  assert.equal(result.ok, false);
});

test("comparison detects native child geometry and invisible ordered attribute changes", () => {
  const drawing = nativeBlockDrawing();
  drawing.entities[1].attributeReferences[0].flags = 1;
  resolveBlocks(drawing);
  const changed = structuredClone(drawing);
  changed.entities[1].attributeReferences[0].value = "different";
  const report = compareDrawings(drawing, changed, TOLERANCE_V0);
  assert.ok(report.findings.some((finding) => finding.axis === "block" && finding.message.includes("native-geometry-or-ordered-attributes")));
  const geometry = structuredClone(drawing);
  geometry.entities[1].children[0].points[1].x += 50;
  assert.ok(compareDrawings(drawing, geometry, TOLERANCE_V0).axes.block.score < 1);
});

test("constant ATTDEF with a corresponding ATTRIB is rendered only once", () => {
  const drawing = nativeBlockDrawing();
  drawing.blockDefinitions[0].attributeDefinitions[0].flags = 2;
  drawing.entities[1].attributeReferences = [{ ...drawing.entities[1].attributeReferences[0], flags: 2 }];
  resolveBlocks(drawing);
  assert.equal(drawing.entities[1].children.filter((entity) => entity.type === "text").length, 1);
});
