import test from "node:test";
import assert from "node:assert/strict";
import DxfParser from "dxf-parser";
import { createDrawing, line, circle, text, applyTransaction } from "../src/cad-core.js";
import { exportDxf } from "../src/dxf-export.js";
import { parseCadImport } from "../src/importers.js";
import { importUnits } from "../src/import-units.js";

function source(unit) {
  return createDrawing({ unit, entities: [line("layer-structure", [1, 2], [3, 4]), circle("layer-structure", [2, 3], 0.5), text("layer-structure", [3, 4], "test", { size: 0.2 })] });
}
function load(drawing, content) {
  const imported = parseCadImport({ filename: "units.dxf", content, drawing, currentLayerId: "layer-structure" });
  const result = applyTransaction(drawing, { commands: imported.commands });
  assert.equal(result.ok, true);
  return { drawing: result.drawing, imported };
}

test("empty drawing adopts DXF meters and re-exports INSUNITS without changing geometry", () => {
  const result = load(createDrawing(), exportDxf(source("m")).content);
  assert.equal(result.drawing.unit, "m");
  assert.deepEqual(result.drawing.entities[0].points[1], { x: 3, y: 4 });
  assert.equal(new DxfParser().parseSync(exportDxf(result.drawing).content).header.$INSUNITS, 6);
  assert.equal(load(createDrawing(), exportDxf(result.drawing).content).drawing.unit, "m");
});

test("merge converts imported geometry to target units without changing existing entities", () => {
  for (const [from, to, factor] of [["m", "mm", 1000], ["mm", "m", 0.001]]) {
    const existing = source(to);
    const result = load(existing, exportDxf(source(from)).content);
    assert.equal(result.drawing.unit, to);
    assert.deepEqual(result.drawing.entities.slice(0, 3), existing.entities);
    assert.deepEqual(result.drawing.entities[3].points[1], { x: 3 * factor, y: 4 * factor });
    assert.equal(result.drawing.entities[4].radius, 0.5 * factor);
    assert.equal(result.drawing.entities[5].size, 0.2 * factor);
    assert.equal(result.imported.unitConversion.factor, factor);
  }
});

test("unitless DXF warns and unsupported units fail without a drawing mutation", () => {
  const original = exportDxf(source("mm")).content;
  const drawing = createDrawing(), before = structuredClone(drawing);
  const unitless = original.replace("$INSUNITS\n70\n4", "$INSUNITS\n70\n0");
  assert.match(load(drawing, unitless).imported.warnings[0], /単位が未指定/);
  assert.throws(() => load(drawing, original.replace("$INSUNITS\n70\n4", "$INSUNITS\n70\n1")), /INSUNITS=1/);
  assert.deepEqual(drawing, before);
  assert.throws(() => importUnits(source("mm"), "m").convert(line("layer-structure", [1e308, 0], [0, 0])), /数値範囲/);
});

test("unit transaction is validated, permission-checked and refuses populated drawings", () => {
  const transaction = { commands: [{ op: "set_empty_drawing_unit", unit: "m" }] };
  assert.equal(applyTransaction(createDrawing(), transaction).drawing.unit, "m");
  assert.equal(applyTransaction(source("mm"), transaction).ok, false);
  assert.equal(applyTransaction(createDrawing({ currentRole: "viewer" }), transaction).ok, false);
  assert.equal(applyTransaction(createDrawing({ state: "approved" }), transaction).ok, false);
  assert.equal(applyTransaction(createDrawing(), { commands: [{ op: "set_empty_drawing_unit", unit: "inch" }] }).ok, false);
});

test("drawing JSON restores declared units and rejects unsafe mixed-unit merging", () => {
  const content = JSON.stringify(source("m"));
  const drawing = createDrawing();
  const imported = parseCadImport({ filename: "saved.json", content, drawing, currentLayerId: "layer-structure" });
  const restored = applyTransaction(drawing, { commands: imported.commands });
  assert.equal(restored.ok, true);
  assert.equal(restored.drawing.unit, "m");
  assert.deepEqual(restored.drawing.entities[0].points[1], { x: 3, y: 4 });
  assert.throws(() => parseCadImport({ filename: "saved.json", content, drawing: source("mm"), currentLayerId: "layer-structure" }), /単位が既存図面と異なります/);
});
