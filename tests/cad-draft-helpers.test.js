import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_OSNAP_MODES,
  OSNAP_MODES,
  applyOrtho,
  closestPointOnSegment,
  entityKeyPoints,
  entitySegments,
  findOsnapPoint,
  perpendicularFoot,
  segmentIntersection
} from "../src/cad-draft-helpers.js";
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

// --- 高精度編集(Round 2): OSnapの中点・交点・垂線・近接点対応 ---

test("entitySegments decomposes line/rect/polyline into segments", () => {
  const l = line("layer-structure", [0, 0], [100, 0]);
  assert.deepEqual(entitySegments(l), [{ a: { x: 0, y: 0 }, b: { x: 100, y: 0 } }]);

  const r = rect("layer-structure", [0, 0], 100, 50);
  assert.equal(entitySegments(r).length, 4);

  const openP = polyline("layer-structure", [[0, 0], [10, 0], [10, 10]]);
  assert.equal(entitySegments(openP).length, 2, "open polyline has n-1 segments");

  const closedP = polyline("layer-structure", [[0, 0], [10, 0], [10, 10]], { closed: true });
  assert.equal(entitySegments(closedP).length, 3, "closed polyline closes back to start");

  assert.deepEqual(entitySegments(circle("layer-structure", [0, 0], 5)), [], "circle has no segments");
});

test("closestPointOnSegment clamps the projection to the segment", () => {
  const a = { x: 0, y: 0 };
  const b = { x: 100, y: 0 };
  assert.deepEqual(closestPointOnSegment({ x: 50, y: 30 }, a, b), { x: 50, y: 0 });
  assert.deepEqual(closestPointOnSegment({ x: -10, y: 30 }, a, b), { x: 0, y: 0 }, "clamps before start");
  assert.deepEqual(closestPointOnSegment({ x: 200, y: -30 }, a, b), { x: 100, y: 0 }, "clamps after end");
});

test("perpendicularFoot returns the foot only when inside the segment", () => {
  const a = { x: 0, y: 0 };
  const b = { x: 100, y: 0 };
  assert.deepEqual(perpendicularFoot({ x: 50, y: 40 }, a, b), { x: 50, y: 0 });
  assert.equal(perpendicularFoot({ x: -20, y: 40 }, a, b), null, "foot outside segment");
  assert.equal(perpendicularFoot({ x: 120, y: 40 }, a, b), null);
});

test("segmentIntersection returns crossing points but not shared endpoints", () => {
  const horizontal = { a: { x: 0, y: 50 }, b: { x: 100, y: 50 } };
  const vertical = { a: { x: 50, y: 0 }, b: { x: 50, y: 100 } };
  assert.deepEqual(segmentIntersection(horizontal, vertical), { x: 50, y: 50 });

  const parallel = { a: { x: 0, y: 10 }, b: { x: 100, y: 10 } };
  assert.equal(segmentIntersection(horizontal, parallel), null, "parallel");

  const disjoint = { a: { x: 200, y: 0 }, b: { x: 200, y: 100 } };
  assert.equal(segmentIntersection(horizontal, disjoint), null, "disjoint");

  // 共有端点(線がつながっているだけ)は交点にしない
  const sharing = { a: { x: 100, y: 50 }, b: { x: 200, y: 50 } };
  assert.equal(segmentIntersection(horizontal, sharing), null, "shared endpoint is not an intersection");
});

test("OSNAP_MODES lists the supported snap modes and defaults keep endpoint/midpoint/center/quadrant/intersection", () => {
  assert.deepEqual(OSNAP_MODES, [
    "endpoint", "midpoint", "center", "quadrant", "intersection", "perpendicular", "nearest"
  ]);
  assert.equal(DEFAULT_OSNAP_MODES.endpoint, true);
  assert.equal(DEFAULT_OSNAP_MODES.midpoint, true);
  assert.equal(DEFAULT_OSNAP_MODES.center, true);
  assert.equal(DEFAULT_OSNAP_MODES.quadrant, true);
  assert.equal(DEFAULT_OSNAP_MODES.intersection, true);
  assert.equal(DEFAULT_OSNAP_MODES.perpendicular, false, "perpendicular defaults off to avoid misfires");
  assert.equal(DEFAULT_OSNAP_MODES.nearest, false, "nearest defaults off to avoid misfires");
});

test("findOsnapPoint snaps to a line midpoint when midpoint mode is enabled", () => {
  const drawing = {
    layers: [{ id: "layer-structure", visible: true }],
    entities: [line("layer-structure", [0, 0], [1000, 0], { id: "e_line" })]
  };
  assert.deepEqual(findOsnapPoint(drawing, { x: 505, y: 8 }, 20), { x: 500, y: 0 });
  assert.equal(findOsnapPoint(drawing, { x: 505, y: 300 }, 20), null, "far from the line");
});

test("findOsnapPoint finds an intersection of two crossing lines", () => {
  const drawing = {
    layers: [{ id: "layer-structure", visible: true }],
    entities: [
      line("layer-structure", [0, 50], [1000, 50], { id: "e_h" }),
      line("layer-structure", [500, 0], [500, 1000], { id: "e_v" })
    ]
  };
  assert.deepEqual(findOsnapPoint(drawing, { x: 506, y: 55 }, 20), { x: 500, y: 50 });
  assert.equal(findOsnapPoint(drawing, { x: 900, y: 900 }, 20), null);
});

test("findOsnapPoint supports disabling modes via the modes argument", () => {
  const drawing = {
    layers: [{ id: "layer-structure", visible: true }],
    entities: [
      line("layer-structure", [0, 0], [1000, 0], { id: "e_h" }),
      line("layer-structure", [500, 0], [500, 1000], { id: "e_v" })
    ]
  };
  // 交点モードを切れば、線の上(500,55)では何も吸着しない(端点・中点から遠い)
  const modes = { ...DEFAULT_OSNAP_MODES, intersection: false };
  assert.equal(findOsnapPoint(drawing, { x: 506, y: 55 }, 20, modes), null);
  // 中点だけを有効にした場合、中点へ吸着する
  const midpointOnly = { ...DEFAULT_OSNAP_MODES, endpoint: false, intersection: false };
  assert.deepEqual(findOsnapPoint(drawing, { x: 505, y: 8 }, 20, midpointOnly), { x: 500, y: 0 });
});

test("findOsnapPoint snaps perpendicular when enabled", () => {
  const drawing = {
    layers: [{ id: "layer-structure", visible: true }],
    entities: [line("layer-structure", [100, 0], [900, 0], { id: "e_line" })]
  };
  const modes = { ...DEFAULT_OSNAP_MODES, perpendicular: true };
  assert.deepEqual(findOsnapPoint(drawing, { x: 400, y: 15 }, 20, modes), { x: 400, y: 0 });
  // 足までの距離がtoleranceを超える場合は垂線スナップしない(近傍の他候補も無ければnull)
  assert.equal(findOsnapPoint(drawing, { x: 400, y: 300 }, 20, modes), null);
});

test("findOsnapPoint snaps nearest-on-segment when enabled and closer than endpoints", () => {
  const drawing = {
    layers: [{ id: "layer-structure", visible: true }],
    entities: [line("layer-structure", [0, 0], [1000, 0], { id: "e_line" })]
  };
  const modes = { ...DEFAULT_OSNAP_MODES, nearest: true };
  // 端点(1000,0)までの距離 √(494²+6²)≈494 に対し、線上の最近点(506,0)は約6 → nearestが勝つ
  assert.deepEqual(findOsnapPoint(drawing, { x: 506, y: 6 }, 20, modes), { x: 506, y: 0 });
});
