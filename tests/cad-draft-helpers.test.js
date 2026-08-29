import test from "node:test";
import assert from "node:assert/strict";
import { applyOrtho, entityKeyPoints, findOsnapPoint } from "../src/cad-draft-helpers.js";
import { circle, line, polyline, rect } from "../src/cad-core.js";

test("applyOrtho pins the axis with the smaller delta to the anchor", () => {
  assert.deepEqual(applyOrtho({ x: 0, y: 0 }, { x: 120, y: 40 }), { x: 120, y: 0 });
  assert.deepEqual(applyOrtho({ x: 0, y: 0 }, { x: 40, y: 120 }), { x: 0, y: 120 });
  assert.deepEqual(applyOrtho(null, { x: 40, y: 120 }), { x: 40, y: 120 });
});

test("entityKeyPoints returns endpoints/corners/quadrants per entity type", () => {
  const l = line("layer-structure", [0, 0], [100, 0]);
  assert.deepEqual(entityKeyPoints(l), l.points);

  const r = rect("layer-structure", [0, 0], 100, 50);
  assert.deepEqual(entityKeyPoints(r), [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 50 },
    { x: 0, y: 50 }
  ]);

  const c = circle("layer-structure", [10, 10], 5);
  assert.deepEqual(entityKeyPoints(c), [
    { x: 10, y: 10 },
    { x: 15, y: 10 },
    { x: 5, y: 10 },
    { x: 10, y: 15 },
    { x: 10, y: 5 }
  ]);

  const p = polyline("layer-structure", [[0, 0], [10, 0], [10, 10]]);
  assert.deepEqual(entityKeyPoints(p), p.points);
});

test("findOsnapPoint snaps to the nearest visible entity vertex within tolerance", () => {
  const drawing = {
    layers: [
      { id: "layer-structure", visible: true },
      { id: "layer-hidden", visible: false }
    ],
    entities: [
      rect("layer-structure", [1000, 1000], 200, 200, { id: "e_rect" }),
      line("layer-hidden", [1000, 1000], [1500, 1000], { id: "e_hidden" })
    ]
  };

  assert.deepEqual(findOsnapPoint(drawing, { x: 1195, y: 1010 }, 30), { x: 1200, y: 1000 });
  assert.equal(findOsnapPoint(drawing, { x: 1500, y: 1500 }, 30), null);
  assert.equal(findOsnapPoint(drawing, { x: 1495, y: 1000 }, 30), null, "hidden layer must not be snappable");
});
