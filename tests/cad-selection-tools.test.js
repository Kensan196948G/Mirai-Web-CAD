import assert from "node:assert/strict";
import test from "node:test";
import { applyTransaction, arc, circle, createDrawing, line, polyline, spline, sampleSpline } from "../src/cad-core.js";
import { quickSelect, selectByPath } from "../src/cad-selection-tools.js";
import { duplicateEntityIds, lengthenEntity, reverseEntity, unusedLayerIds } from "../src/cad-edit.js";
import { parseCadCommand } from "../src/cad-command.js";
import { parseCadImport } from "../src/importers.js";

const layer = "layer-structure";
const point = (x, y) => ({ x, y });
function fixture() {
  const a = line(layer, [0, 0], [100, 0], { id: "a" });
  const b = line(layer, [0, 50], [100, 50], { id: "b" });
  const c = circle("layer-annotation", [200, 200], 20, { id: "c" });
  return createDrawing({ entities: [a, b, c] });
}

test("fence and lasso use geometry and exclude hidden layers", () => {
  const drawing = fixture();
  assert.deepEqual(selectByPath(drawing, [point(50, -10), point(50, 60)]), ["a", "b"]);
  assert.deepEqual(selectByPath(drawing, [point(-10, -10), point(110, -10), point(110, 10), point(-10, 10)], "lasso"), ["a"]);
  assert.deepEqual(selectByPath(drawing, [point(190, 190), point(210, 190), point(210, 210), point(190, 210)], "lasso"), []);
  drawing.layers.find((item) => item.id === layer).visible = false;
  assert.deepEqual(selectByPath(drawing, [point(50, -10), point(50, 60)]), []);
  assert.throws(() => selectByPath(drawing, [point(0, 0)], "lasso"), /path/);
});

test("conditional selection combines type, layer, rendered color and width", () => {
  const drawing = fixture();
  assert.deepEqual(quickSelect(drawing, { type: "LINE", layer, width: "2" }), ["a", "b"]);
  assert.deepEqual(quickSelect(drawing, { type: "circle", layer }), []);
  assert.throws(() => quickSelect(createDrawing(), { width: "invalid" }), /width/);
  const context = { drawing, selectedIds: ["a"], previousSelection: ["b"] };
  assert.deepEqual(parseCadCommand("SELECT PREVIOUS", context).entityIds, ["b"]);
  assert.deepEqual(parseCadCommand("SELECT LAST", context).entityIds, ["c"]);
  assert.deepEqual(parseCadCommand("SELECTSIMILAR", context).entityIds, ["a", "b"]);
});

test("selection sets are permission checked, persisted and recalled without deleted entities", () => {
  const drawing = fixture();
  const parsed = parseCadCommand('SELECTION SAVE "work set"', { drawing, selectedIds: ["a", "b"] });
  assert.equal(applyTransaction({ ...drawing, currentRole: "viewer" }, { commands: parsed.commands }).ok, false);
  const result = applyTransaction(drawing, { commands: parsed.commands });
  assert.equal(result.ok, true);
  assert.deepEqual(result.drawing.selectionSets, [{ name: "work set", entityIds: ["a", "b"] }]);
  const afterDelete = applyTransaction(result.drawing, { commands: [{ op: "delete", id: "b" }] }).drawing;
  assert.deepEqual(parseCadCommand('SELECTION LOAD "work set"', { drawing: afterDelete }).entityIds, ["a"]);
  assert.equal(applyTransaction(drawing, { commands: [{ op: "save_selection", name: "bad", entityIds: ["missing"] }] }).ok, false);
});

test("JSON selection sets remap IDs and avoid overwriting same-name destination sets", () => {
  const drawing = fixture();
  drawing.selectionSets = [{ name: "work", entityIds: ["a"] }];
  const imported = parseCadImport({ filename: "drawing.json", content: JSON.stringify(drawing), drawing, currentLayerId: layer });
  const result = applyTransaction(drawing, { commands: imported.commands });
  assert.equal(result.ok, true);
  assert.equal(result.drawing.selectionSets[1].name, "work (1)");
  assert.notEqual(result.drawing.selectionSets[1].entityIds[0], "a");
  assert.ok(result.drawing.entities.some((entity) => entity.id === result.drawing.selectionSets[1].entityIds[0]));
});

test("LENGTHEN changes line total length and arc arc-length without moving starts", () => {
  assert.deepEqual(lengthenEntity(line(layer, [0, 0], [3, 4]), 10).points[1], point(6, 8));
  const next = lengthenEntity(arc(layer, [0, 0], 10, 30, 60), Math.PI * 10 / 2);
  assert.ok(Math.abs(next.endAngle - 120) < 1e-9);
  assert.equal(next.startAngle, 30);
  assert.throws(() => lengthenEntity(next, Math.PI * 20), /circle/);
});

test("REVERSE preserves polyline geometry and reverses spline parameterization", () => {
  const path = polyline(layer, [[0, 0], [10, 0], [10, 10]], { closed: true });
  assert.deepEqual(reverseEntity(path).points, [...path.points].reverse());
  const curve = spline(layer, [[0, 0], [10, 30], [40, 10], [60, 0]]);
  const forward = sampleSpline(curve), backward = sampleSpline(reverseEntity(curve)).reverse();
  forward.forEach((p, index) => assert.ok(Math.hypot(p.x - backward[index].x, p.y - backward[index].y) < 1e-8));
});

test("PURGE preserves current, locked and nested-child layers", () => {
  const drawing = fixture();
  drawing.layers.find((item) => item.id === "layer-frame").locked = true;
  const purged = unusedLayerIds(drawing, "layer-center");
  assert.ok(!purged.includes(layer));
  assert.ok(!purged.includes("layer-frame"));
  assert.ok(!purged.includes("layer-center"));
  assert.deepEqual(purged, ["layer-temporary"]);
  drawing.entities.push({ type: "block", layerId: layer, children: [{ type: "block", layerId: layer, children: [line("layer-temporary", [0, 0], [1, 1])] }] });
  assert.deepEqual(unusedLayerIds(drawing, "layer-center"), []);
});

test("OVERKILL removes exact duplicates but preserves appearance, metadata and references", () => {
  const drawing = fixture();
  const duplicate = { ...structuredClone(drawing.entities[0]), id: "duplicate", points: [...drawing.entities[0].points].reverse() };
  const different = { ...structuredClone(duplicate), id: "different", style: { strokeWidth: 5 } };
  drawing.entities.push(duplicate, different);
  assert.deepEqual(duplicateEntityIds(drawing, drawing.entities), ["duplicate"]);
  duplicate.meta.custom = "retain";
  assert.deepEqual(duplicateEntityIds(drawing, drawing.entities), []);
  delete duplicate.meta.custom;
  drawing.entities.push({ id: "dim", type: "dimension", references: [{ entityId: "duplicate" }] });
  assert.deepEqual(duplicateEntityIds(drawing, drawing.entities), []);
});
