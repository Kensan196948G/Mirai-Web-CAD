import test from "node:test";
import assert from "node:assert/strict";
import { blockEntity, dimensionEntity, editLineEndpoint, hatchEntity, measurePoints, offsetEntity, transformEntity } from "../src/cad-advanced.js";
import { entityArea, entityBounds, line, rect, validateDrawing } from "../src/cad-core.js";

test("move, rotate, and scale preserve deterministic geometry", () => {
  const source = line("layer-structure", [0, 0], [100, 0]);
  const moved = transformEntity(source, { dx: 20, dy: 30 });
  assert.deepEqual(moved.points, [{ x: 20, y: 30 }, { x: 120, y: 30 }]);
  const rotated = transformEntity(source, { angle: 90, base: { x: 0, y: 0 } });
  assert.ok(Math.abs(rotated.points[1].x) < 1e-9);
  assert.equal(Math.round(rotated.points[1].y), 100);
  const scaled = transformEntity(source, { scale: 2, base: { x: 0, y: 0 } });
  assert.equal(scaled.points[1].x, 200);
});

test("offset, trim, and extend reject invalid geometry", () => {
  const source = line("layer-structure", [0, 0], [100, 0]);
  assert.deepEqual(offsetEntity(source, 20).points, [{ x: 0, y: 20 }, { x: 100, y: 20 }]);
  assert.equal(editLineEndpoint(source, { x: 25, y: 0 }, "TRIM").points[0].x, 25);
  assert.equal(editLineEndpoint(source, { x: 180, y: 0 }, "EXTEND").points[1].x, 180);
  assert.throws(() => offsetEntity(source, 0), /距離/);
  assert.throws(() => editLineEndpoint(rect("layer-structure", [0, 0], 10, 10), { x: 5, y: 5 }, "TRIM"), /線分/);
});

test("dimension, hatch, block, and measurement expose bounds and quantities", () => {
  const dimension = dimensionEntity("layer-annotation", [0, 0], [300, 400]);
  assert.equal(measurePoints(dimension.points[0], dimension.points[1]).distance, 500);
  const hatch = hatchEntity("layer-structure", [[0, 0], [100, 0], [100, 50], [0, 50]]);
  assert.equal(entityArea(hatch), 5000);
  const block = blockEntity("layer-structure", "桝", [500, 600], [rect("layer-structure", [0, 0], 100, 100)]);
  assert.deepEqual(entityBounds(block), { minX: 500, minY: 600, maxX: 600, maxY: 700 });
  assert.equal(validateDrawing({ id: "test", layers: [{ id: "layer-structure" }, { id: "layer-annotation" }], entities: [dimension, hatch, block] }).filter((issue) => issue.severity === "critical").length, 0);
});
