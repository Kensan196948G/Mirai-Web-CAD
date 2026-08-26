import test from "node:test";
import assert from "node:assert/strict";
import {
  applyTransaction,
  approveDrawing,
  buildAiProposal,
  circle,
  line,
  measurements,
  proposalToTransaction,
  seedDrawing,
  validateDrawing
} from "../src/cad-core.js";

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
      { op: "update_layer", id: "layer-structure", patch: { locked: true, visible: "no", name: "ignored" } }
    ]
  });
  assert.equal(result.ok, true);
  assert.equal(result.drawing.layers.find((layer) => layer.id === "layer-structure").locked, true);
  assert.equal(result.drawing.layers.find((layer) => layer.id === "layer-structure").visible, true);
  assert.equal(result.drawing.layers.find((layer) => layer.id === "layer-structure").name, "構造物");
  assert.equal(result.drawing.commandEvents.at(-1).label, "lock layer");
});
