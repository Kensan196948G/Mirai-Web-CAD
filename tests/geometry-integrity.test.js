import test from "node:test";
import assert from "node:assert/strict";
import { approveDrawing, createDrawing, entityBounds, validateDrawing } from "../src/cad-core.js";
import { handleApiRequest, resetMemoryStore } from "../src/api-handler.js";

// 独立レビュー(2026-09-18)で検出した「不正な図形を保存でき、後で承認が500で固まる」問題の回帰テスト。
//  - /transactions は保存前に構造不正を検出していなかった
//  - entityBounds/validateDrawing が不正な図形で例外を投げ、承認経路が500になっていた

const env = { AUTH_MODE: "demo", APP_ENV: "preview" };

async function createBlankDrawing(id) {
  const response = await handleApiRequest(
    new Request("https://example.test/api/drawings", {
      method: "POST",
      headers: { "content-type": "application/json", "x-demo-role": "drafter", "idempotency-key": `create-${id}` },
      body: JSON.stringify({ id, name: "形状検証", unit: "mm" })
    }),
    env
  );
  const text = await response.text();
  assert.equal(response.status, 201, text);
}

function transactionRequest(drawingId, commands, key, expectedVersion = "1") {
  return new Request(`https://example.test/api/drawings/${drawingId}/transactions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-demo-role": "drafter",
      "idempotency-key": key,
      "expected-version": expectedVersion
    },
    body: JSON.stringify({ label: "形状検証", commands })
  });
}

test("pointsの無いlineは保存前に400で拒否する(承認を500で固まらせない)", async () => {
  resetMemoryStore();
  await createBlankDrawing("dwg_geo1");
  const response = await handleApiRequest(
    transactionRequest("dwg_geo1", [{ op: "add", entity: { id: "e_bad", type: "line", layerId: "layer-structure" } }], "tx-geo1"),
    env
  );
  const text = await response.text();
  assert.equal(response.status, 400, text);
  const body = JSON.parse(text);
  assert.match(body.error, /形状が不正|図形が不正/);
  assert.ok(Array.isArray(body.issues) && body.issues.length > 0);
});

test("widthが数値でないrectは保存前に400で拒否する", async () => {
  resetMemoryStore();
  await createBlankDrawing("dwg_geo2");
  const response = await handleApiRequest(
    transactionRequest(
      "dwg_geo2",
      [{ op: "add", entity: { id: "e_bad_rect", type: "rect", layerId: "layer-structure", origin: { x: 0, y: 0 }, width: "abc", height: 100 } }],
      "tx-geo2"
    ),
    env
  );
  const text = await response.text();
  assert.equal(response.status, 400, text);
});

test("正常な図形は従来どおり保存できる", async () => {
  resetMemoryStore();
  await createBlankDrawing("dwg_geo3");
  const response = await handleApiRequest(
    transactionRequest(
      "dwg_geo3",
      [{ op: "add", entity: { id: "e_ok", type: "line", layerId: "layer-structure", points: [{ x: 0, y: 0 }, { x: 1000, y: 0 }], style: { strokeWidth: 1, lineDash: [], fill: "transparent" }, meta: {} } }],
      "tx-geo3"
    ),
    env
  );
  const text = await response.text();
  assert.equal(response.status, 200, text);
});

test("entityBoundsは不正な図形で例外を投げずnullを返す", () => {
  const malformed = [
    null,
    {},
    { type: "line" },
    { type: "line", points: null },
    { type: "polyline", points: [{}] },
    { type: "rect", origin: { x: 0, y: 0 }, width: "10", height: 10 },
    { type: "rect" },
    { type: "text", at: { x: 0, y: 0 } },
    { type: "text", value: "あ", size: 0 },
    { type: "circle", center: { x: 0, y: 0 }, radius: -5 },
    { type: "hatch" }
  ];
  for (const entity of malformed) {
    assert.equal(entityBounds(entity), null, `例外または非null: ${JSON.stringify(entity)}`);
  }
});

test("validateDrawingは不正な図形でも例外を投げずissuesを返す", () => {
  const drawing = createDrawing();
  drawing.entities.push({ id: "e_broken", type: "line", layerId: drawing.layers[0].id });
  drawing.entities.push({ id: "e_broken2", type: "rect", layerId: drawing.layers[0].id, origin: { x: 0, y: 0 }, width: "x", height: 1 });
  let issues;
  assert.doesNotThrow(() => {
    issues = validateDrawing(drawing);
  });
  assert.ok(issues.some((issue) => issue.code === "invalid-geometry"));
});

test("不正な図形を含む図面の承認は例外ではなく失敗を返す(409相当)", () => {
  const drawing = createDrawing();
  drawing.currentRole = "approver";
  drawing.state = "in_review";
  drawing.entities.push({ id: "e_broken", type: "line", layerId: drawing.layers[0].id });
  let result;
  assert.doesNotThrow(() => {
    result = approveDrawing(drawing, "approver@example.com");
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /Critical|不正/);
});
