import assert from "node:assert/strict";
import test from "node:test";
import { applyTransaction, createDrawing, line, polyline, rect } from "../src/cad-core.js";
import { blockEntity } from "../src/cad-advanced.js";
import { explodeEntity, matchProperties, stretchEntity } from "../src/cad-edit.js";
import { parseCadCommand } from "../src/cad-command.js";

const layer = "layer-structure";
test("stretch moves vertices inside the crossing box without moving the other endpoint", () => {
  const entity = line(layer, [0, 0], [1000, 0]);
  const next = stretchEntity(entity, { x: 900, y: -10 }, { x: 1100, y: 10 }, { x: 200, y: 30 });
  assert.deepEqual(next.points, [{ x: 0, y: 0 }, { x: 1200, y: 30 }]);
  assert.deepEqual(entity.points[1], { x: 1000, y: 0 });
});

test("explode preserves closure, style and transformed block geometry", () => {
  const path = polyline(layer, [[0, 0], [10, 0], [10, 10]], { closed: true, style: { color: "#123456" } });
  const pieces = explodeEntity(path);
  assert.equal(pieces.length, 3);
  assert.deepEqual(pieces[2].points[1], { x: 0, y: 0 });
  assert.deepEqual(pieces[0].style, path.style);
  const block = blockEntity(layer, "box", [100, 200], [rect(layer, [0, 0], 10, 20)], {}, { rotation: 90, scale: 2 });
  const [box] = explodeEntity(block);
  assert.equal(box.type, "polyline");
  assert.ok(Math.abs(box.points[1].x - 100) < 1e-9);
  assert.ok(Math.abs(box.points[1].y - 220) < 1e-9);
  assert.throws(() => explodeEntity({ ...block, attributes: { name: "A" } }), /attribute/);
});

test("match properties copies appearance and layer without geometry or identity", () => {
  const source = line("layer-annotation", [0, 0], [10, 0], { style: { strokeWidth: 3 } });
  const target = line(layer, [100, 100], [200, 100]);
  const next = matchProperties(source, target);
  assert.deepEqual(next.points, target.points);
  assert.equal(next.id, target.id);
  assert.equal(next.layerId, source.layerId);
  assert.deepEqual(next.style, source.style);
});

test("CLI selected-set operations are atomic and locked layers reject the entire edit", () => {
  const a = line(layer, [0, 0], [10, 0]);
  const b = line("layer-annotation", [20, 0], [30, 0]);
  const drawing = createDrawing({ entities: [a, b], currentRole: "drafter" });
  const context = { drawing, selectedIds: [a.id, b.id], selectedId: b.id, currentLayerId: layer };
  const properties = parseCadCommand(`MATCHPROP ${b.id} ${a.id}`, context);
  const matched = applyTransaction(drawing, { source: "user", commands: properties.commands });
  assert.equal(matched.ok, true);
  assert.equal(matched.drawing.entities[0].layerId, b.layerId);
  for (const input of ["MOVE 10,20", "COPY 10,20", "ROTATE 90 0,0", "SCALE 2 0,0", "ERASE", "STRETCH -1,-1 11,1 5,0"]) {
    const parsed = parseCadCommand(input, context);
    assert.equal(parsed.commands.length, 2, input);
    assert.equal(applyTransaction(drawing, { source: "user", commands: parsed.commands }).ok, true, input);
  }
  drawing.layers.find((item) => item.id === b.layerId).locked = true;
  const parsed = parseCadCommand("MOVE 10,20", context);
  const result = applyTransaction(drawing, { source: "user", commands: parsed.commands });
  assert.equal(result.ok, false);
  assert.deepEqual(result.drawing.entities, [a, b]);
  const match = parseCadCommand(`MATCHPROP ${b.id} ${a.id}`, context);
  assert.equal(applyTransaction(drawing, { source: "user", commands: match.commands }).ok, false);
});
