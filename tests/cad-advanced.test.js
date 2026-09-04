import test from "node:test";
import assert from "node:assert/strict";
import {
  arrayEntity,
  blockEntity,
  breakEntity,
  dimensionEntity,
  editLineEndpoint,
  hatchEntity,
  joinLines,
  measurePoints,
  mirrorEntity,
  offsetEntity,
  transformEntity
} from "../src/cad-advanced.js";
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

// --- 高精度編集(Round 3): MIRROR / ARRAY / BREAK / JOIN ---

test("mirrorEntity reflects a line about a vertical axis", () => {
  const source = line("layer-structure", [100, 0], [100, 100]); // 軸x=0に対し対象外側へ
  const mirrored = mirrorEntity(source, { x: 0, y: 0 }, { x: 0, y: 100 });
  assert.deepEqual(mirrored.points, [{ x: -100, y: 0 }, { x: -100, y: 100 }]);
});

test("mirrorEntity reflects a polyline about an arbitrary axis", () => {
  const source = { type: "polyline", layerId: "layer-structure", points: [{ x: 2, y: 0 }, { x: 4, y: 0 }], closed: false };
  const mirrored = mirrorEntity(source, { x: 0, y: 0 }, { x: 0, y: 1 }); // y軸(x=0)で反転
  assert.deepEqual(mirrored.points, [{ x: -2, y: 0 }, { x: -4, y: 0 }]);
});

test("mirrorEntity converts a rect to a closed polyline and reflects the quadrants", () => {
  const source = rect("layer-structure", [10, 20], 100, 50);
  const mirrored = mirrorEntity(source, { x: 0, y: 0 }, { x: 0, y: 1 }); // x=0軸で反転
  assert.equal(mirrored.type, "polyline");
  assert.equal(mirrored.closed, true);
  assert.deepEqual(mirrored.points, [
    { x: -10, y: 20 },
    { x: -110, y: 20 },
    { x: -110, y: 70 },
    { x: -10, y: 70 }
  ]);
  assert.equal(entityArea(mirrored), 5000, "面積は矩形と同一を保つ");
});

test("mirrorEntity reflects a circle center and a text insertion point", () => {
  const circle = { type: "circle", layerId: "layer-structure", center: { x: 30, y: 0 }, radius: 5 };
  assert.deepEqual(mirrorEntity(circle, { x: 0, y: 0 }, { x: 0, y: 1 }).center, { x: -30, y: 0 });
  const textEntity = { type: "text", layerId: "layer-annotation", at: { x: 10, y: 10 }, value: "ABC", size: 100 };
  assert.deepEqual(mirrorEntity(textEntity, { x: 0, y: 0 }, { x: 0, y: 1 }).at, { x: -10, y: 10 });
});

test("mirrorEntity rejects a zero-length mirror axis", () => {
  assert.throws(() => mirrorEntity(line("layer-structure", [0, 0], [1, 0]), { x: 5, y: 5 }, { x: 5, y: 5 }), /軸/);
});

test("arrayEntity duplicates a line across a 3x2 grid with spacing", () => {
  const source = line("layer-structure", [0, 0], [100, 0]);
  const copies = arrayEntity(source, 3, 2, 200, 300);
  assert.equal(copies.length, 5, "元位置を除く3×2-1=5件");
  const starts = copies.map((copy) => copy.points[0]);
  assert.deepEqual(starts, [
    { x: 200, y: 0 },
    { x: 400, y: 0 },
    { x: 0, y: 300 },
    { x: 200, y: 300 },
    { x: 400, y: 300 }
  ]);
  for (const copy of copies) {
    assert.ok(copy.id.startsWith("e_array_"), "新IDを採番する");
  }
});

test("arrayEntity validates counts and spacing", () => {
  const source = line("layer-structure", [0, 0], [100, 0]);
  assert.throws(() => arrayEntity(source, 0, 5, 100, 100), /1以上の整数/, "0列は拒否する");
  assert.throws(() => arrayEntity(source, 2, 0, 100, 100), /1以上の整数/, "0行は拒否する");
  assert.throws(() => arrayEntity(source, 2, 2, Number.NaN, 100), /間隔/);
  // 複写数の上限(1000件)を超える指定はブラウザ凍結防止のため拒否する(CodeRabbit Major対応)
  assert.throws(() => arrayEntity(source, 100, 100, 100, 100), /多すぎます/); // 9999件
  assert.throws(() => arrayEntity(source, 1, 1002, 100, 100), /多すぎます/); // 1001件
  // 上限内(1000件以下)は成功する
  assert.equal(arrayEntity(source, 1000, 1, 100, 100).length, 999); // 1000×1-1
  assert.equal(arrayEntity(source, 1, 1001, 100, 100).length, 1000); // 上限ちょうど1000コピー
});

test("breakEntity splits a line into two collinear lines", () => {
  const source = line("layer-structure", [0, 0], [100, 0], { id: "e_line" });
  const pieces = breakEntity(source, { x: 40, y: 0 });
  assert.equal(pieces.length, 2);
  assert.equal(pieces[0].type, "line");
  assert.deepEqual(pieces[0].points, [{ x: 0, y: 0 }, { x: 40, y: 0 }]);
  assert.deepEqual(pieces[1].points, [{ x: 40, y: 0 }, { x: 100, y: 0 }]);
  // 線分から離れた点(垂直距離が線分長の1%超)では分割しない
  assert.throws(() => breakEntity(source, { x: 40, y: 3 }), /線分上/);
});

test("breakEntity splits an open polyline into two polylines", () => {
  const source = { type: "polyline", layerId: "layer-structure", points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }], closed: false };
  const pieces = breakEntity(source, { x: 40, y: 0 });
  assert.equal(pieces.length, 2);
  assert.equal(pieces[0].type, "polyline");
  assert.deepEqual(pieces[0].points, [{ x: 0, y: 0 }, { x: 40, y: 0 }]);
  assert.deepEqual(pieces[1].points, [{ x: 40, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }]);
});

test("breakEntity rejects off-segment points, closed polylines, and unsupported types", () => {
  const lineEntity = line("layer-structure", [0, 0], [100, 0]);
  assert.throws(() => breakEntity(lineEntity, { x: 200, y: 0 }), /線分上/);
  const open = { type: "polyline", layerId: "layer-structure", points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }], closed: false };
  assert.throws(() => breakEntity(open, { x: 40, y: 40 }), /ポリライン上/);
  const closed = { type: "polyline", layerId: "layer-structure", points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }], closed: true };
  assert.throws(() => breakEntity(closed, { x: 40, y: 0 }), /閉じた/);
  assert.throws(() => breakEntity(rect("layer-structure", [0, 0], 10, 10), { x: 5, y: 5 }), /対象外/);
});

test("breakEntity picks the nearest polyline segment rather than the first in tolerance", () => {
  // 平行で近接する2セグメント: (0,0)-(50,0) と (50,0)-(100,0)。入力点は後者に近い
  const source = {
    type: "polyline",
    layerId: "layer-structure",
    points: [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 100, y: 0 }],
    closed: false
  };
  const pieces = breakEntity(source, { x: 75, y: 0 });
  assert.equal(pieces.length, 2);
  assert.deepEqual(pieces[0].points, [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 75, y: 0 }]);
  assert.deepEqual(pieces[1].points, [{ x: 75, y: 0 }, { x: 100, y: 0 }]);
});

test("joinLines merges two collinear lines sharing an endpoint", () => {
  const first = line("layer-structure", [0, 0], [100, 0], { id: "e_a" });
  const second = line("layer-structure", [100, 0], [250, 0], { id: "e_b" });
  const joined = joinLines(first, second);
  assert.ok(joined);
  assert.deepEqual(joined.points, [{ x: 0, y: 0 }, { x: 250, y: 0 }]);
});

test("joinLines returns null for disjoint or non-collinear lines", () => {
  const disjoint = line("layer-structure", [0, 0], [50, 0]);
  const far = line("layer-structure", [500, 0], [600, 0]);
  assert.equal(joinLines(disjoint, far), null, "端点が一致しない");
  const corner = line("layer-structure", [100, 0], [100, 100]);
  assert.equal(joinLines(disjoint, corner), null, "端点一致でも同一直線でない");
});
