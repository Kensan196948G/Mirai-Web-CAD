import test from "node:test";
import assert from "node:assert/strict";
import {
  arrayEntity,
  blockEntity,
  breakEntity,
  chamferLines,
  collectBoundarySegments,
  createBoundaryEntity,
  dimensionEntity,
  editLineEndpoint,
  editPolyline,
  extendEntityToBoundary,
  filletLines,
  hatchEntity,
  joinLines,
  measurePoints,
  mirrorEntity,
  offsetEntity,
  parallelOffsetPoints,
  transformEntity,
  trimEntityToBoundaries
} from "../src/cad-advanced.js";
import { arc, ellipse, entityArea, entityBounds, line, rect, spline, validateDrawing } from "../src/cad-core.js";

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

test("ellipse and spline preserve native geometry through transform and mirror", () => {
  const oval = ellipse("layer-structure", [100, 100], 80, 40, 15);
  const scaledOval = transformEntity(oval, { scale: 2, angle: 30, base: { x: 100, y: 100 } });
  assert.equal(scaledOval.radiusX, 160);
  assert.equal(scaledOval.radiusY, 80);
  assert.equal(scaledOval.rotation, 45);
  const mirroredOval = mirrorEntity(oval, { x: 0, y: 0 }, { x: 0, y: 100 });
  assert.ok(Math.abs(mirroredOval.center.x + 100) < 1e-9);
  assert.ok(Math.abs(mirroredOval.rotation - 165) < 1e-9);

  const curve = spline("layer-structure", [[0, 0], [50, 100], [100, 0]]);
  const movedCurve = transformEntity(curve, { dx: 20, dy: 30 });
  assert.deepEqual(movedCurve.controlPoints, [{ x: 20, y: 30 }, { x: 70, y: 130 }, { x: 120, y: 30 }]);
  const mirroredCurve = mirrorEntity(curve, { x: 0, y: 0 }, { x: 0, y: 100 });
  assert.deepEqual(mirroredCurve.controlPoints, [{ x: 0, y: 0 }, { x: -50, y: 100 }, { x: -100, y: 0 }]);
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

// --- 高精度編集(Round 6): CHAMFER / FILLET / BOUNDARY / PEDIT ---

test("chamferLines trims two corner lines and creates a connector", () => {
  const horizontal = line("layer-structure", [0, 0], [100, 0], { id: "e_horizontal" });
  const vertical = line("layer-structure", [0, 0], [0, 100], { id: "e_vertical" });
  const result = chamferLines(horizontal, vertical, 20, 30);
  assert.deepEqual(roundPoints(result.first.points), [{ x: 20, y: 0 }, { x: 100, y: 0 }]);
  assert.deepEqual(roundPoints(result.second.points), [{ x: 0, y: 30 }, { x: 0, y: 100 }]);
  assert.deepEqual(roundPoints(result.connector.points), [{ x: 20, y: 0 }, { x: 0, y: 30 }]);
});

test("filletLines creates a tangent quarter arc as a native arc", () => {
  const horizontal = line("layer-structure", [0, 0], [100, 0], { id: "e_horizontal" });
  const vertical = line("layer-structure", [0, 0], [0, 100], { id: "e_vertical" });
  const result = filletLines(horizontal, vertical, 20);
  assert.deepEqual(roundPoints(result.first.points), [{ x: 20, y: 0 }, { x: 100, y: 0 }]);
  assert.deepEqual(roundPoints(result.second.points), [{ x: 0, y: 20 }, { x: 0, y: 100 }]);
  assert.equal(result.arc.type, "arc");
  assert.deepEqual(roundPoints([result.arc.center]), [{ x: 20, y: 20 }]);
  assert.equal(result.arc.radius, 20);
  assert.equal(Math.round(((result.arc.endAngle - result.arc.startAngle + 360) % 360)), 90);
});

test("native arc rotates, offsets, and mirrors while preserving sweep", () => {
  const source = arc("layer-structure", [100, 100], 20, 0, 90);
  const rotated = transformEntity(source, { angle: 45, base: { x: 100, y: 100 } });
  assert.equal(rotated.startAngle, 45);
  assert.equal(rotated.endAngle, 135);
  assert.equal(offsetEntity(source, 5).radius, 25);
  const mirrored = mirrorEntity(source, { x: 0, y: 0 }, { x: 0, y: 1 });
  assert.deepEqual(roundPoints([mirrored.center]), [{ x: -100, y: 100 }]);
  assert.equal(Math.round((mirrored.endAngle - mirrored.startAngle + 360) % 360), 90);
});

test("chamferLines and filletLines reject invalid inputs", () => {
  const first = line("layer-structure", [0, 0], [100, 0]);
  const parallel = line("layer-structure", [0, 10], [100, 10]);
  assert.throws(() => chamferLines(first, parallel, 10), /平行/);
  assert.throws(() => filletLines(first, parallel, 10), /平行/);
  assert.throws(() => chamferLines(first, line("layer-structure", [0, 0], [0, 100]), 0), /0より大きい/);
});

test("createBoundaryEntity orders connected lines into a closed polyline", () => {
  const edges = [
    line("layer-structure", [100, 0], [100, 50]),
    line("layer-structure", [0, 50], [0, 0]),
    line("layer-structure", [100, 50], [0, 50]),
    line("layer-structure", [0, 0], [100, 0])
  ];
  const boundary = createBoundaryEntity("layer-structure", edges, { id: "e_boundary" });
  assert.equal(boundary.closed, true);
  assert.equal(boundary.points.length, 4);
  assert.equal(entityArea(boundary), 5000);
  assert.throws(() => createBoundaryEntity("layer-structure", edges.slice(0, 3)), /接続|閉合/);
});

test("editPolyline moves, adds, deletes, closes, and opens vertices", () => {
  const source = { type: "polyline", layerId: "layer-structure", points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }], closed: false };
  const moved = editPolyline(source, "MOVE", 1, { x: 120, y: 10 });
  assert.deepEqual(moved.points[1], { x: 120, y: 10 });
  const added = editPolyline(source, "ADD", 0, { x: 50, y: 0 });
  assert.deepEqual(added.points[1], { x: 50, y: 0 });
  const deleted = editPolyline(added, "DELETE", 1);
  assert.deepEqual(deleted.points, source.points);
  assert.equal(editPolyline(source, "CLOSE").closed, true);
  assert.equal(editPolyline({ ...source, closed: true }, "OPEN").closed, false);
  assert.throws(() => editPolyline(source, "MOVE", 9, { x: 0, y: 0 }), /範囲外/);
  assert.throws(() => editPolyline(source, "MOVE", 1, { x: 0, y: 0 }), /同一点/);
  assert.throws(() => editPolyline(line("layer-structure", [0, 0], [1, 1]), "OPEN"), /ポリライン/);
});

// --- 高精度編集(Round 4): ポリライン/ハッチの真の平行オフセット ---

/** 座標を許容差内で比較するための丸め(浮動小数点誤差の吸収) */
function roundPoints(points) {
  return points.map((p) => ({ x: Math.round(p.x * 1e6) / 1e6, y: Math.round(p.y * 1e6) / 1e6 }));
}

test("parallelOffsetPoints offsets a CCW rectangle outward (miter join at corners)", () => {
  // 反時計回り矩形: 符号付き面積>0
  const rect = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 50 },
    { x: 0, y: 50 }
  ];
  const result = roundPoints(parallelOffsetPoints(rect, true, 10));
  assert.deepEqual(result, [
    { x: -10, y: -10 },
    { x: 110, y: -10 },
    { x: 110, y: 60 },
    { x: -10, y: 60 }
  ]);
});

test("parallelOffsetPoints offsets a CW rectangle inward for negative distance", () => {
  // 時計回り矩形: distance<0 で内側へ(絶対値10)
  const rect = [
    { x: 0, y: 0 },
    { x: 0, y: 50 },
    { x: 100, y: 50 },
    { x: 100, y: 0 }
  ];
  const result = roundPoints(parallelOffsetPoints(rect, true, -10));
  // 内側10mmへ: 頂点順は入力の向きに従い変わり得るため、集合として比較する
  const sorted = (points) => points.map((p) => `${p.x},${p.y}`).sort().join("|");
  assert.equal(sorted(result), sorted([
    { x: 10, y: 10 },
    { x: 90, y: 10 },
    { x: 90, y: 40 },
    { x: 10, y: 40 }
  ]));
});

test("offsetEntity offsets a closed polyline to a true parallel shape (not radial)", () => {
  const poly = { type: "polyline", layerId: "layer-structure", closed: true, points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 50 }, { x: 0, y: 50 }] };
  const next = offsetEntity(poly, 10);
  assert.deepEqual(roundPoints(next.points), [
    { x: -10, y: -10 },
    { x: 110, y: -10 },
    { x: 110, y: 60 },
    { x: -10, y: 60 }
  ]);
  // 全ての辺が元図形と平行(面積は矩形として拡大している)
  assert.equal((110 - -10) * (60 - -10), 120 * 70);
});

test("offsetEntity offsets an open polyline to its left side (same sign rule as line)", () => {
  // (0,0)-(100,0)-(100,100): 上方向に折れるL字。距離20の左オフセット
  const poly = { type: "polyline", layerId: "layer-structure", closed: false, points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }] };
  const next = offsetEntity(poly, 20);
  // 第1辺(0,0)-(100,0)の左オフセット: y=20。第2辺(100,0)-(100,100)の左オフセット: x=80
  // miter: (80,20)。始点(0,20)。終点(80,100)
  assert.deepEqual(next.points, [
    { x: 0, y: 20 },
    { x: 80, y: 20 },
    { x: 80, y: 100 }
  ]);
});

test("offsetEntity offsets a hatch boundary outward as a closed region", () => {
  const hatch = { type: "hatch", layerId: "layer-structure", points: [{ x: 0, y: 0 }, { x: 60, y: 0 }, { x: 60, y: 40 }, { x: 0, y: 40 }], pattern: "ANSI31" };
  const next = offsetEntity(hatch, 5);
  assert.deepEqual(next.points, [
    { x: -5, y: -5 },
    { x: 65, y: -5 },
    { x: 65, y: 45 },
    { x: -5, y: 45 }
  ]);
});

test("parallelOffsetPoints rejects zero-length segments and degenerate inputs", () => {
  assert.deepEqual(parallelOffsetPoints([{ x: 0, y: 0 }, { x: 0, y: 0 }], false, 10), [], "0長セグメント");
  assert.deepEqual(parallelOffsetPoints([], false, 10), []);
  assert.deepEqual(parallelOffsetPoints([{ x: 0, y: 0 }], false, 10), []);
});

test("parallelOffsetPoints preserves true parallelism for a slanted triangle", () => {
  // 直角三角形(反時計回り): (0,0)-(40,0)-(0,30)
  const tri = [
    { x: 0, y: 0 },
    { x: 40, y: 0 },
    { x: 0, y: 30 }
  ];
  const result = parallelOffsetPoints(tri, true, 4);
  assert.equal(result.length, 3);
  const rounded = roundPoints(result);
  // 各辺と元の辺の平行性: 辺ベクトルの外積が0になることを確認する
  const seg = (points, i) => {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    return { dx: b.x - a.x, dy: b.y - a.y };
  };
  for (let i = 0; i < 3; i += 1) {
    const orig = seg(tri, i);
    const off = seg(rounded, i);
    const cross = Math.abs(orig.dx * off.dy - orig.dy * off.dx);
    assert.ok(cross < 1e-6, `辺${i}が元の辺と平行でない cross=${cross}`);
  }
});

// --- 高精度編集(Round 5): 境界交点演算による正確なTRIM/EXTEND ---

test("collectBoundarySegments flattens line/rect/polyline boundaries into segments", () => {
  const lineB = line("layer-structure", [0, 0], [100, 0]);
  const rectB = rect("layer-structure", [0, 0], 100, 50);
  const segments = collectBoundarySegments([lineB, rectB]);
  assert.equal(segments.length, 5, "line 1本 + rect 4辺");
});

test("trimEntityToBoundaries clips a line at the nearest crossing boundary on the keep side", () => {
  // 対象線(0,0)-(1000,0)を、境界線x=500の縦線で切る。クリック点(700,0)は右側を残す
  const subject = line("layer-structure", [0, 0], [1000, 0], { id: "e_target" });
  const boundary = line("layer-structure", [500, -100], [500, 100]);
  const trimmed = trimEntityToBoundaries(subject, [boundary], { x: 700, y: 0 });
  assert.deepEqual(trimmed.points, [{ x: 500, y: 0 }, { x: 1000, y: 0 }]);
});

test("trimEntityToBoundaries keeps the left side when the click point is on the left", () => {
  const subject = line("layer-structure", [0, 0], [1000, 0], { id: "e_target" });
  const boundary = line("layer-structure", [300, -100], [300, 100]);
  const trimmed = trimEntityToBoundaries(subject, [boundary], { x: 100, y: 0 });
  assert.deepEqual(trimmed.points, [{ x: 0, y: 0 }, { x: 300, y: 0 }]);
});

test("trimEntityToBoundaries supports multiple crossing boundaries", () => {
  const subject = line("layer-structure", [0, 0], [1000, 0], { id: "e_target" });
  const boundaryA = line("layer-structure", [200, -100], [200, 100]);
  const boundaryB = line("layer-structure", [800, -100], [800, 100]);
  // クリック点(500,0): 200〜800の区間を残す
  const trimmed = trimEntityToBoundaries(subject, [boundaryA, boundaryB], { x: 500, y: 0 });
  assert.deepEqual(trimmed.points, [{ x: 200, y: 0 }, { x: 800, y: 0 }]);
});

test("trimEntityToBoundaries rejects no-intersection and off-line clicks", () => {
  const subject = line("layer-structure", [0, 0], [1000, 0], { id: "e_target" });
  const parallel = line("layer-structure", [0, 100], [1000, 100]); // 交差しない
  assert.throws(() => trimEntityToBoundaries(subject, [parallel], { x: 500, y: 0 }), /交差/);
  assert.throws(() => trimEntityToBoundaries(subject, [line("layer-structure", [500, -100], [500, 100])], { x: 500, y: 500 }), /線分上/);
  // クリック点が対象線分の範囲外(射影t<0)でもエラーにする(CodeRabbit Major対応)
  assert.throws(() => trimEntityToBoundaries(subject, [line("layer-structure", [500, -100], [500, 100])], { x: -100, y: 0 }), /線分上/);
  assert.throws(() => trimEntityToBoundaries(subject, [line("layer-structure", [500, -100], [500, 100])], { x: 1500, y: 0 }), /線分上/);
  assert.throws(() => trimEntityToBoundaries(rect("layer-structure", [0, 0], 10, 10), [], { x: 5, y: 5 }), /線分/);
});

test("extendEntityToBoundary extends the nearer endpoint to the boundary", () => {
  const subject = line("layer-structure", [0, 0], [300, 0], { id: "e_target" });
  const boundary = line("layer-structure", [800, -100], [800, 100]);
  // クリック点(350,0)は右端点に近い → (300,0)が(800,0)へ延長される
  const extended = extendEntityToBoundary(subject, [boundary], { x: 350, y: 0 });
  assert.deepEqual(extended.points, [{ x: 0, y: 0 }, { x: 800, y: 0 }]);
});

test("extendEntityToBoundary extends only toward the boundary that is intersected", () => {
  const subject = line("layer-structure", [1000, 0], [1500, 0], { id: "e_target" });
  const boundary = line("layer-structure", [500, -100], [500, 100]);
  // クリック点(1200,0)は左端点に近い。左側の境界x=500へ延長
  const extended = extendEntityToBoundary(subject, [boundary], { x: 1200, y: 0 });
  assert.deepEqual(extended.points, [{ x: 500, y: 0 }, { x: 1500, y: 0 }]);
});

test("extendEntityToBoundary rejects when no boundary lies on the ray", () => {
  const subject = line("layer-structure", [0, 0], [300, 0], { id: "e_target" });
  const boundary = line("layer-structure", [-500, -100], [-500, 100]); // 反対側のみ
  assert.throws(() => extendEntityToBoundary(subject, [boundary], { x: 350, y: 0 }), /見つかりません/);
  assert.throws(() => extendEntityToBoundary(rect("layer-structure", [0, 0], 10, 10), [], { x: 5, y: 5 }), /線分/);
});

test("collectBoundarySegments always closes hatch boundaries", () => {
  // hatchEntityはclosedを持たないが、境界としては常に閉路(最終→先頭セグメント)を収集する
  const hatchB = hatchEntity("layer-structure", [[0, 0], [100, 0], [100, 50]]);
  const segments = collectBoundarySegments([hatchB]);
  assert.equal(segments.length, 3, "hatch 3点の閉路 = 3セグメント(最終→先頭を含む)");
  assert.deepEqual(segments[2], { a: { x: 100, y: 50 }, b: { x: 0, y: 0 } });
});
test("extendEntityToBoundary is not limited by a finite virtual ray", () => {
  // 極小の線分(1e-6長)でも、遠方(2単位先)の境界まで延長できる(CodeRabbit Major対応)
  const subject = line("layer-structure", [0, 0], [1e-6, 0], { id: "e_tiny" });
  const boundary = line("layer-structure", [2, -1], [2, 1]);
  const extended = extendEntityToBoundary(subject, [boundary], { x: 1e-6, y: 0 });
  assert.deepEqual(extended.points, [{ x: 0, y: 0 }, { x: 2, y: 0 }]);
});

test("extendEntityToBoundary picks the nearest boundary on the ray", () => {
  const subject = line("layer-structure", [0, 0], [1, 0], { id: "e_line" });
  const near = line("layer-structure", [10, -1], [10, 1]);
  const far = line("layer-structure", [50, -1], [50, 1]);
  // クリック点(0.9,0)は右端点(1,0)に近いため、+x方向(境界x=10側)へ延長する
  const extended = extendEntityToBoundary(subject, [near, far], { x: 0.9, y: 0 });
  assert.deepEqual(extended.points, [{ x: 0, y: 0 }, { x: 10, y: 0 }]);
});
