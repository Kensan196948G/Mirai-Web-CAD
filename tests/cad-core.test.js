import test from "node:test";
import assert from "node:assert/strict";
import {
  applyTransaction,
  approveDrawing,
  boundsIntersect,
  buildAiProposal,
  circle,
  entityBounds,
  line,
  measurements,
  proposalToTransaction,
  seedDrawing,
  validateDrawing
} from "../src/cad-core.js";
import { dimensionEntity } from "../src/cad-advanced.js";

test("seed drawing has editable entities and no critical validation errors", () => {
  const drawing = seedDrawing();
  assert.equal(drawing.entities.length >= 8, true);
  const critical = validateDrawing(drawing).filter((issue) => issue.severity === "critical");
  assert.equal(critical.length, 0);
});

test("transactions reject locked layer changes", () => {
  const drawing = seedDrawing();
  const lockedLayer = drawing.layers.find((layer) => layer.id === "layer-structure");
  lockedLayer.locked = true;
  const result = applyTransaction(drawing, {
    source: "user",
    label: "locked add",
    commands: [{ op: "add", entity: line("layer-structure", [0, 0], [100, 100]) }]
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /ロック中レイヤー/);
});

test("viewer role is fail-closed for write transactions", () => {
  const drawing = { ...seedDrawing(), currentRole: "viewer" };
  const result = applyTransaction(drawing, {
    source: "user",
    label: "viewer add",
    commands: [{ op: "add", entity: circle("layer-temporary", [100, 100], 50) }]
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /変更できません/);
});

test("agent proposal requires human approval before mutating drawing", () => {
  const drawing = seedDrawing();
  const proposal = buildAiProposal(drawing, "クレーンの重機範囲を追加");
  assert.equal(proposal.status, "planned");
  assert.equal(drawing.entities.some((entity) => entity.id.startsWith("preview_crane_")), false);

  const result = applyTransaction(drawing, proposalToTransaction(proposal, "drafter"));
  assert.equal(result.ok, true);
  assert.equal(result.drawing.entities.length, drawing.entities.length + proposal.impact.add);
});

test("approval is rejected when role lacks approval permission", () => {
  const drawing = seedDrawing();
  const result = approveDrawing(drawing, "drafter");
  assert.equal(result.ok, false);
  assert.match(result.error, /承認できません/);
});

test("measurements aggregate length and area", () => {
  const value = measurements(seedDrawing());
  assert.equal(value.entityCount > 0, true);
  assert.equal(value.totalLength > 0, true);
  assert.equal(value.totalArea > 0, true);
});

test("successful edits advance revision and content hash detects coordinate changes", () => {
  const drawing = seedDrawing();
  const target = drawing.entities.find((entity) => entity.id === "e_box_1");
  const result = applyTransaction(drawing, {
    source: "user",
    label: "move for revision proof",
    commands: [{ op: "update", id: target.id, patch: { origin: { x: target.origin.x + 100, y: target.origin.y } } }]
  });
  assert.equal(result.ok, true);
  assert.equal(result.drawing.revision, drawing.revision + 1);
  const event = result.drawing.commandEvents.at(-1);
  assert.notEqual(event.beforeHash, event.afterHash);
});

test("layer updates use the audited transaction path", () => {
  const drawing = seedDrawing();
  const result = applyTransaction(drawing, {
    source: "user",
    label: "lock layer",
    commands: [
      { op: "update_layer", id: "layer-structure", patch: { locked: true, visible: "no", name: "施工構造", color: "invalid" } }
    ]
  });
  assert.equal(result.ok, true);
  assert.equal(result.drawing.layers.find((layer) => layer.id === "layer-structure").locked, true);
  assert.equal(result.drawing.layers.find((layer) => layer.id === "layer-structure").visible, true);
  assert.equal(result.drawing.layers.find((layer) => layer.id === "layer-structure").name, "施工構造");
  assert.equal(result.drawing.layers.find((layer) => layer.id === "layer-structure").color, "#1574b8");
  assert.equal(result.drawing.commandEvents.at(-1).label, "lock layer");
});

test("boundsIntersect detects overlap, disjoint and touching boxes", () => {
  const viewport = { minX: 0, minY: 0, maxX: 100, maxY: 100 };
  assert.equal(boundsIntersect({ minX: 10, minY: 10, maxX: 20, maxY: 20 }, viewport), true);
  assert.equal(boundsIntersect({ minX: -50, minY: -50, maxX: 150, maxY: 150 }, viewport), true);
  assert.equal(boundsIntersect({ minX: 100, minY: 0, maxX: 120, maxY: 10 }, viewport), true);
  assert.equal(boundsIntersect({ minX: 200, minY: 200, maxX: 220, maxY: 220 }, viewport), false);
  assert.equal(boundsIntersect(null, viewport), true);
  assert.equal(boundsIntersect(entityBounds(circle("layer-temporary", [10000, 10000], 5)), viewport), false);
  assert.equal(boundsIntersect(entityBounds(line("layer-temporary", [10, 10], [50, 50])), viewport), true);
});

test("entityBounds for a dimension includes the offset extension line, not just its endpoints", () => {
  // 端点はy=200(viewport外)にあるが、offset=-200で寸法線本体はy=0(viewport内)まで伸びる。
  const dimension = dimensionEntity("layer-annotation", [0, 200], [300, 200], { offset: -200 });
  const bounds = entityBounds(dimension);
  assert.equal(bounds.minY <= 0, true);
  const viewport = { minX: -50, minY: -50, maxX: 400, maxY: 50 };
  assert.equal(boundsIntersect(bounds, viewport), true);
});
