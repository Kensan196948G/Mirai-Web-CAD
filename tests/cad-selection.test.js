import assert from "node:assert/strict";
import test from "node:test";
import { arc, circle, createDrawing, line, polyline, spline } from "../src/cad-core.js";
import { blockEntity, transformEntity } from "../src/cad-advanced.js";
import { entityGrips, moveGrip, selectInBox } from "../src/cad-selection.js";

const layer = "layer-structure";
const drawing = (entities) => createDrawing({ entities });

test("window contains entire geometry; crossing intersects geometry rather than its bounds", () => {
  const diagonal = line(layer, [0, 0], [100, 100]);
  const round = circle(layer, [200, 200], 100);
  const doc = drawing([diagonal, round]);
  assert.deepEqual(selectInBox(doc, { x: -1, y: -1 }, { x: 101, y: 101 }, false), [diagonal.id]);
  assert.deepEqual(selectInBox(doc, { x: 0, y: 90 }, { x: 10, y: 100 }, true), []);
  assert.deepEqual(selectInBox(doc, { x: 40, y: 40 }, { x: 60, y: 60 }, true), [diagonal.id]);
  assert.deepEqual(selectInBox(doc, { x: 190, y: 190 }, { x: 210, y: 210 }, true), []);
  assert.deepEqual(selectInBox(doc, { x: 299, y: 190 }, { x: 310, y: 210 }, true), [round.id]);
});

test("crossing checks arc sweep and polyline segments, hidden and frozen layers are excluded", () => {
  const curve = arc(layer, [0, 0], 100, 0, 90);
  const path = polyline(layer, [[0, 0], [100, 0], [100, 100]]);
  const doc = drawing([curve, path]);
  assert.deepEqual(selectInBox(doc, { x: -101, y: -1 }, { x: -99, y: 1 }, true), []);
  assert.deepEqual(selectInBox(doc, { x: 69, y: 69 }, { x: 72, y: 72 }, true), [curve.id]);
  doc.layers.find((item) => item.id === layer).visible = false;
  assert.deepEqual(selectInBox(doc, { x: -200, y: -200 }, { x: 200, y: 200 }), []);
});

test("grip editing changes only the chosen point and keeps the original immutable", () => {
  const path = spline(layer, [[0, 0], [50, 100], [100, 0]]);
  const edited = moveGrip(path, entityGrips(path)[1], { x: 60, y: 120 });
  assert.deepEqual(edited.controlPoints[1], { x: 60, y: 120 });
  assert.deepEqual(path.controlPoints[1], { x: 50, y: 100 });
  const round = circle(layer, [0, 0], 10);
  assert.throws(() => moveGrip(round, entityGrips(round)[1], { x: 0, y: 0 }), /radius/);
});

test("block motion transforms the reference once and preserves local children", () => {
  const child = line(layer, [0, 0], [10, 0]);
  const block = blockEntity(layer, "test", [100, 200], [child]);
  const moved = transformEntity(block, { dx: 50, dy: 20, scale: 2 });
  assert.deepEqual(moved.insertion, { x: 250, y: 420 });
  assert.deepEqual(moved.children, block.children);
  assert.equal(moved.scale, 2);
});
