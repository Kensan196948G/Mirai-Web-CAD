import assert from "node:assert/strict";
import test from "node:test";
import { applyTransaction, approveDrawing, circle, createDrawing, line, validateDrawing } from "../src/cad-core.js";
import { dimensionEntity } from "../src/cad-advanced.js";
import { dimensionGeometry } from "../src/cad-dimension.js";
import { parseCadCommand } from "../src/cad-command.js";
import { parseCadImport } from "../src/importers.js";
import { entityGrips, moveGrip } from "../src/cad-selection.js";

const layer = "layer-structure";
function fixture(command = "DIMASSOC") {
  const source = command.includes("RADIUS") || command.includes("DIAMETER") ? circle(layer, [1000, 1000], 500) : line(layer, [1000, 1000], [2000, 1000]);
  const drawing = createDrawing({ currentRole: "drafter", entities: [source] });
  const parsed = parseCadCommand(`${command} ${source.id}`, { drawing, currentLayerId: layer });
  const result = applyTransaction(drawing, { source: "user", commands: parsed.commands });
  assert.equal(result.ok, true);
  return { source, drawing: result.drawing, dimension: result.drawing.entities[1] };
}

test("associative dimension follows endpoint stretch in the same transaction", () => {
  const { source, drawing, dimension } = fixture();
  const parsed = parseCadCommand(`STRETCH 1900,900 2100,1100 200,0 ${source.id}`, { drawing });
  const result = applyTransaction(drawing, { source: "user", commands: parsed.commands });
  assert.equal(result.ok, true);
  assert.equal(dimensionGeometry(result.drawing.entities[1]).label, "1200");
  assert.equal(result.drawing.entities[1].associationStatus, "associated");
  assert.equal(dimensionGeometry(dimension).label, "1000");
  assert.equal(result.drawing.revision, drawing.revision + 1);
});

test("dimension resolves after all commands regardless of update order", () => {
  const { source, drawing, dimension } = fixture();
  const result = applyTransaction(drawing, { source: "user", commands: [
    { op: "update", id: dimension.id, patch: { points: [{ x: 0, y: 0 }, { x: 2, y: 0 }], precision: 2 } },
    { op: "update", id: source.id, patch: { points: [{ x: 1000, y: 1000 }, { x: 2400, y: 1000 }] } }
  ] });
  assert.equal(dimensionGeometry(result.drawing.entities[1]).label, "1400.00");
});

test("deleted references show no stale value, block approval, and reattach on restoration", () => {
  const { source, drawing } = fixture();
  const deleted = applyTransaction(drawing, { source: "user", commands: [{ op: "delete", id: source.id }] }).drawing;
  assert.equal(dimensionGeometry(deleted.entities[0]).label, "[?]");
  const before = JSON.stringify(deleted);
  assert.ok(validateDrawing(deleted).some((issue) => issue.code === "broken-dimension"));
  assert.equal(JSON.stringify(deleted), before);
  assert.equal(approveDrawing({ ...deleted, currentRole: "approver", state: "review" }).ok, false);
  const restored = applyTransaction(deleted, { source: "user", commands: [{ op: "add", entity: source }] }).drawing;
  assert.equal(dimensionGeometry(restored.entities[0]).label, "1000");
});

test("projected and radial dimensions measure the intended axis and radius", () => {
  for (const [dimensionType, expected] of [["aligned", 500], ["horizontal", 300], ["vertical", 400], ["radius", 500], ["diameter", 1000]]) {
    const dimension = dimensionEntity(layer, [0, 0], [300, 400], { dimensionType });
    assert.equal(dimensionGeometry(dimension).value, expected);
  }
  for (const [command, expected] of [["DIMRADIUS", "R600"], ["DIMDIAMETER", "DIA 1200"]]) {
    const { source, drawing } = fixture(command);
    const result = applyTransaction(drawing, { source: "user", commands: [{ op: "update", id: source.id, patch: { radius: 600 } }] });
    assert.equal(dimensionGeometry(result.drawing.entities[1]).label, expected);
  }
});

test("dimension style and offset grip preserve association and reject invalid precision atomically", () => {
  const { drawing, dimension } = fixture("DIMHORIZONTAL");
  const grip = entityGrips(dimension).find((value) => value.key === "offset");
  const edited = moveGrip(dimension, grip, { x: 1500, y: 1700 });
  assert.equal(edited.offset, 700);
  assert.deepEqual(edited.references, dimension.references);
  assert.equal(entityGrips(dimension).some((value) => value.key === "points"), false);
  const parsed = parseCadCommand('DIMSTYLE 2 250 100 "L=" "mm"', { drawing, selectedIds: [dimension.id] });
  const result = applyTransaction(drawing, { source: "user", commands: parsed.commands });
  assert.equal(dimensionGeometry(result.drawing.entities[1]).label, "L=1000.00mm");
  const invalid = applyTransaction(drawing, { source: "user", commands: [{ op: "update", id: dimension.id, patch: { precision: 99 } }] });
  assert.equal(invalid.ok, false);
  assert.deepEqual(invalid.drawing, drawing);
});

test("JSON import remaps association IDs and never binds missing sources to destination entities", () => {
  const { drawing, source } = fixture();
  const target = createDrawing();
  const imported = parseCadImport({ filename: "drawing.json", content: JSON.stringify(drawing), drawing: target, currentLayerId: layer });
  const result = applyTransaction(target, { source: "system", commands: imported.commands });
  assert.equal(result.ok, true);
  const dimension = result.drawing.entities.find((entity) => entity.type === "dimension");
  const importedSource = result.drawing.entities.find((entity) => entity.type === "line");
  assert.equal(dimension.references[0].entityId, importedSource.id);
  assert.notEqual(importedSource.id, source.id);
  assert.equal(dimension.associationStatus, "associated");
  const incomplete = parseCadImport({ filename: "drawing.json", content: JSON.stringify({ entities: [drawing.entities[1]] }), drawing, currentLayerId: layer });
  assert.ok(incomplete.warnings.length > 0);
  const orphan = applyTransaction(drawing, { source: "user", commands: incomplete.commands }).drawing.entities.at(-1);
  assert.equal(orphan.associationStatus, "broken");
});

test("copying source and dimension binds the copy to the copied source", () => {
  const { drawing, source, dimension } = fixture();
  const parsed = parseCadCommand("COPY 1000,0", { drawing, selectedIds: [source.id, dimension.id] });
  const copied = applyTransaction(drawing, { source: "user", commands: parsed.commands }).drawing;
  const copySource = copied.entities[2], copyDimension = copied.entities[3];
  assert.equal(copyDimension.references[0].entityId, copySource.id);
  const changed = applyTransaction(copied, { source: "user", commands: [{ op: "update", id: copySource.id, patch: { points: [{ x: 2000, y: 1000 }, { x: 3500, y: 1000 }] } }] }).drawing;
  assert.equal(dimensionGeometry(changed.entities[1]).value, 1000);
  assert.equal(dimensionGeometry(changed.entities[3]).value, 1500);
});
