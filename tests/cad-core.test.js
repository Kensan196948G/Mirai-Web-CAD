import test from "node:test";
import assert from "node:assert/strict";
import {
  applyTransaction,
  arc,
  approveDrawing,
  boundsIntersect,
  buildAiProposal,
  circle,
  entityBounds,
  entityLength,
  hitTest,
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

test("AI由来のトランザクションはcommandEventsにsource=agentとして記録される", () => {
  const drawing = seedDrawing();
  const beforeAgentEvents = drawing.commandEvents.filter((event) => event.source === "agent").length;
  const proposal = buildAiProposal(drawing, "クレーンの重機範囲を追加");
  const result = applyTransaction(drawing, proposalToTransaction(proposal, "drafter"));
  assert.equal(result.ok, true);
  const agentEvents = result.drawing.commandEvents.filter((event) => event.source === "agent");
  assert.equal(agentEvents.length, beforeAgentEvents + 1);
  assert.equal(agentEvents.at(-1).label, proposal.label);

  const userEvent = result.drawing.commandEvents.find((event) => event.source === "user");
  assert.equal(userEvent, undefined);
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

test("native arc computes wrapped bounds, length, validation, and hit testing", () => {
  const entity = arc("layer-structure", [100, 100], 50, 350, 100, { id: "e_arc" });
  const bounds = entityBounds(entity);
  assert.ok(Math.abs(bounds.minX - (100 + 50 * Math.cos((100 * Math.PI) / 180))) < 1e-9);
  assert.equal(bounds.minY, 100 + 50 * Math.sin((350 * Math.PI) / 180));
  assert.equal(bounds.maxX, 150);
  assert.equal(bounds.maxY, 150);
  assert.ok(Math.abs(entityLength(entity) - (Math.PI * 50 * 110) / 180) < 1e-9);

  const drawing = seedDrawing();
  drawing.entities.push(entity);
  assert.equal(hitTest(drawing, { x: 150, y: 100 }, 2)?.id, "e_arc");
  assert.notEqual(hitTest(drawing, { x: 50, y: 100 }, 2)?.id, "e_arc", "円弧の範囲外は円周として選択しない");
  assert.equal(validateDrawing(drawing).some((issue) => issue.entityId === "e_arc" && issue.severity === "critical"), false);

  const invalid = arc("layer-structure", [100, 100], 50, 30, 30, { id: "e_bad_arc" });
  drawing.entities.push(invalid);
  assert.equal(validateDrawing(drawing).some((issue) => issue.code === "invalid-arc-angle"), true);
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

test("reviewer can add comments without canEdit, but cannot add entities", () => {
  const drawing = { ...seedDrawing(), currentRole: "reviewer" };
  const commentResult = applyTransaction(drawing, {
    source: "user",
    label: "reviewer comment",
    commands: [{ op: "add_comment", body: "この寸法を確認してください" }]
  });
  assert.equal(commentResult.ok, true);
  assert.equal(commentResult.drawing.comments.length, 1);
  assert.equal(commentResult.drawing.comments[0].author, "reviewer");
  assert.equal(commentResult.drawing.comments[0].resolved, false);

  const editResult = applyTransaction(drawing, {
    source: "user",
    label: "reviewer add entity",
    commands: [{ op: "add", entity: circle("layer-temporary", [100, 100], 50) }]
  });
  assert.equal(editResult.ok, false);
  assert.match(editResult.error, /変更できません/);
});

test("viewer cannot add comments", () => {
  const drawing = { ...seedDrawing(), currentRole: "viewer" };
  const result = applyTransaction(drawing, {
    source: "user",
    label: "viewer comment",
    commands: [{ op: "add_comment", body: "閲覧のみ" }]
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /コメントを追加できません/);
});

test("add_comment defends against drawings without a comments array", () => {
  const drawing = seedDrawing();
  delete drawing.comments;
  const result = applyTransaction(drawing, {
    source: "user",
    label: "legacy drawing comment",
    commands: [{ op: "add_comment", body: "旧データからのコメント" }]
  });
  assert.equal(result.ok, true);
  assert.equal(result.drawing.comments.length, 1);
});

test("add_comment references a missing entity with a warning and nulls the entityId", () => {
  const drawing = seedDrawing();
  const result = applyTransaction(drawing, {
    source: "user",
    label: "comment on missing entity",
    commands: [{ op: "add_comment", body: "存在しない図形へのコメント", entityId: "e_missing" }]
  });
  assert.equal(result.ok, true);
  assert.equal(result.drawing.comments[0].entityId, null);
  assert.match(result.warnings[0], /コメント対象の図形が見つかりません/);
});

test("add_comment strips C0 and C1 control characters from the body", () => {
  const drawing = seedDrawing();
  const result = applyTransaction(drawing, {
    source: "user",
    label: "comment with control characters",
    commands: [{ op: "add_comment", body: "before\u0007\u0080\u009fafter" }]
  });
  assert.equal(result.ok, true);
  assert.equal(result.drawing.comments[0].body, "beforeafter");
});

test("approved drawings reject new comments", () => {
  const drawing = { ...seedDrawing(), state: "approved" };
  const result = applyTransaction(drawing, {
    source: "user",
    label: "comment on approved drawing",
    commands: [{ op: "add_comment", body: "承認済みへのコメント" }]
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /承認済み版は直接変更できません/);
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
