import test from "node:test";
import assert from "node:assert/strict";
import { MODEL_EXTENT, applyTransaction, createDrawing, validateDrawing } from "../src/cad-core.js";

// 2026-09-18の独立レビュー(フロントエンド/業務ロジック)で指摘された
// 「ロック中レイヤーの削除」「用紙範囲の判定根拠」を固定する。

test("ロック中のレイヤーは削除できない", () => {
  const drawing = createDrawing();
  drawing.currentRole = "cad_admin";
  const target = drawing.layers.find((layer) => layer.id === "layer-center");
  assert.ok(target);
  target.locked = true;
  const result = applyTransaction(drawing, {
    source: "user",
    label: "ロック中レイヤー削除",
    commands: [{ op: "delete_layer", id: target.id }]
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /ロック中/);
});

test("ロックされていない空レイヤーは削除できる(既存挙動の維持)", () => {
  const drawing = createDrawing();
  drawing.currentRole = "cad_admin";
  drawing.layers.push({ id: "layer-empty", name: "空レイヤー", color: "#123456", visible: true, locked: false, printable: true });
  const result = applyTransaction(drawing, {
    source: "user",
    label: "空レイヤー削除",
    commands: [{ op: "delete_layer", id: "layer-empty" }]
  });
  assert.equal(result.ok, true);
  assert.equal(result.drawing.layers.some((layer) => layer.id === "layer-empty"), false);
});

test("モデル空間の範囲は単一の定数(MODEL_EXTENT)で定義され、変更できない", () => {
  assert.deepEqual({ ...MODEL_EXTENT }, { minX: 0, minY: 0, maxX: 12000, maxY: 7000 });
  assert.equal(Object.isFrozen(MODEL_EXTENT), true);
});

test("用紙外判定はMODEL_EXTENTに一致し、境界上の図形は用紙内として扱う", () => {
  const drawing = createDrawing();
  const layerId = drawing.layers[0].id;
  const make = (id, points) => ({ id, type: "line", layerId, points, style: {}, meta: {} });

  const outside = { ...drawing, entities: [make("e_out", [{ x: MODEL_EXTENT.maxX + 500, y: 0 }, { x: MODEL_EXTENT.maxX + 800, y: 0 }])] };
  assert.ok(validateDrawing(outside).some((issue) => issue.code === "outside-paper"));

  const onBoundary = { ...drawing, entities: [make("e_edge", [{ x: 0, y: 0 }, { x: MODEL_EXTENT.maxX, y: MODEL_EXTENT.maxY }])] };
  assert.equal(validateDrawing(onBoundary).some((issue) => issue.code === "outside-paper"), false);
});
