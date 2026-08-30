import test from "node:test";
import assert from "node:assert/strict";
import { boundsIntersect, circle, entityBounds, line, polyline, seedDrawing } from "../src/cad-core.js";
import { buildSpatialIndex, queryBounds } from "../src/spatial-index.js";

function bruteForce(entities, viewport) {
  return entities.filter((entity) => boundsIntersect(entityBounds(entity), viewport));
}

test("queryBounds matches brute-force boundsIntersect filtering for a viewport", () => {
  const drawing = seedDrawing();
  const index = buildSpatialIndex(drawing.entities);
  const viewport = { minX: 0, minY: 0, maxX: 6000, maxY: 4000 };

  const expected = bruteForce(drawing.entities, viewport).map((entity) => entity.id).sort();
  const actual = queryBounds(index, viewport).map((entity) => entity.id).sort();
  assert.deepEqual(actual, expected);
});

test("queryBounds excludes entities entirely outside the queried region", () => {
  const entities = [
    line("layer-temporary", [0, 0], [100, 100], { id: "near" }),
    line("layer-temporary", [50000, 50000], [50100, 50100], { id: "far" })
  ];
  const index = buildSpatialIndex(entities);
  const result = queryBounds(index, { minX: -100, minY: -100, maxX: 500, maxY: 500 });
  assert.deepEqual(result.map((entity) => entity.id), ["near"]);
});

test("queryBounds returns every entity when the viewport is null, matching boundsIntersect's fail-open semantics", () => {
  const entities = [
    line("layer-temporary", [0, 0], [100, 100], { id: "a" }),
    line("layer-temporary", [50000, 50000], [50100, 50100], { id: "b" })
  ];
  const index = buildSpatialIndex(entities);
  const result = queryBounds(index, null);
  assert.deepEqual(result.map((entity) => entity.id).sort(), ["a", "b"]);
});

test("queryBounds does not return an entity twice even when its bounds span multiple grid cells", () => {
  const entities = [line("layer-temporary", [-500, 0], [2500, 0], { id: "spanning" })];
  const index = buildSpatialIndex(entities, 1000);
  const result = queryBounds(index, { minX: -1000, minY: -1000, maxX: 3000, maxY: 1000 });
  assert.deepEqual(result.map((entity) => entity.id), ["spanning"]);
});

test("queryBounds always includes entities with unresolvable bounds regardless of the viewport", () => {
  const entities = [
    line("layer-temporary", [0, 0], [100, 100], { id: "normal" }),
    { id: "block-empty", type: "block", layerId: "layer-temporary", children: [], insertion: { x: 0, y: 0 }, rotation: 0, scale: 1 }
  ];
  const index = buildSpatialIndex(entities);
  const result = queryBounds(index, { minX: 90000, minY: 90000, maxX: 90100, maxY: 90100 });
  assert.deepEqual(result.map((entity) => entity.id), ["block-empty"]);
});

test("buildSpatialIndex handles a large synthetic entity set consistently with brute force", () => {
  const entities = Array.from({ length: 2000 }, (_value, index) =>
    index % 2 === 0
      ? line("layer-temporary", [index * 6, 0], [index * 6 + 5, 5], { id: `line_${index}` })
      : circle("layer-temporary", [index * 6, 3000], 3, { id: `circle_${index}` })
  );
  const index = buildSpatialIndex(entities);
  const viewport = { minX: 1000, minY: -50, maxX: 4000, maxY: 3050 };
  const expected = bruteForce(entities, viewport).map((entity) => entity.id).sort();
  const actual = queryBounds(index, viewport).map((entity) => entity.id).sort();
  assert.deepEqual(actual, expected);
});

test("buildSpatialIndex indexes a closed polyline spanning several cells without loss", () => {
  const entities = [
    polyline(
      "layer-temporary",
      [
        [0, 0],
        [2500, 0],
        [2500, 2500],
        [0, 2500]
      ],
      { id: "poly", closed: true }
    )
  ];
  const index = buildSpatialIndex(entities, 1000);
  const result = queryBounds(index, { minX: 2000, minY: 2000, maxX: 2600, maxY: 2600 });
  assert.deepEqual(result.map((entity) => entity.id), ["poly"]);
});
