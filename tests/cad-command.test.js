import test from "node:test";
import assert from "node:assert/strict";
import { parseCadCommand } from "../src/cad-command.js";
import { applyTransaction, line, seedDrawing } from "../src/cad-core.js";

function context(overrides = {}) {
  const drawing = seedDrawing();
  return { drawing, currentLayerId: "layer-structure", selectedId: null, ...overrides };
}

test("command line creates line, rectangle, circle, polyline, and text transactions", () => {
  const cases = [
    ["LINE 0,0 100,200", "line"],
    ["RECT 10,20 110,220", "rect"],
    ["CIRCLE 50,60 25", "circle"],
    ["PLINE 0,0 100,0 100,100 CLOSE", "polyline"],
    ['TEXT 30,40 "施工 注記"', "text"]
  ];
  for (const [input, type] of cases) {
    const parsed = parseCadCommand(input, context());
    assert.equal(parsed.kind, "transaction");
    assert.equal(parsed.commands[0].entity.type, type);
  }
});

test("command line move and copy selected geometry through CAD transactions", () => {
  const drawing = seedDrawing();
  const selectedId = drawing.entities.find((entity) => entity.type === "rect").id;
  const move = parseCadCommand("MOVE 100,50", context({ drawing, selectedId }));
  const moved = applyTransaction(drawing, { source: "user", label: move.label, commands: move.commands });
  assert.equal(moved.ok, true);
  assert.equal(moved.drawing.entities.find((entity) => entity.id === selectedId).origin.x, 2300);

  const copy = parseCadCommand(`COPY ${selectedId} -100,25`, context({ drawing }));
  const copied = applyTransaction(drawing, { source: "user", label: copy.label, commands: copy.commands });
  assert.equal(copied.ok, true);
  assert.equal(copied.drawing.entities.length, drawing.entities.length + 1);
});

test("command line supports UI commands and rejects malformed input", () => {
  assert.deepEqual(parseCadCommand("ZOOM EXTENTS", context()), { kind: "ui", action: "fit" });
  assert.deepEqual(parseCadCommand("UNDO", context()), { kind: "ui", action: "undo" });
  assert.deepEqual(parseCadCommand("REDO", context()), { kind: "ui", action: "redo" });
  assert.equal(parseCadCommand("LAYER 構造物", context()).layerId, "layer-structure");
  assert.equal(parseCadCommand("NEW 仮設計画図", context()).name, "仮設計画図");
  assert.throws(() => parseCadCommand("LINE 0,0 100,", context()), /yが空/);
  assert.throws(() => parseCadCommand("CIRCLE 0,0 -1", context()), /半径/);
  assert.throws(() => parseCadCommand("UNKNOWN", context()), /未対応/);
});

test("advanced commands create and transform production CAD geometry", () => {
  const drawing = seedDrawing();
  const selectedId = drawing.entities.find((entity) => entity.type === "line").id;
  const selectedContext = context({ drawing, selectedId });
  for (const input of ["ROTATE 45", "SCALE 2", "OFFSET 100"]) {
    assert.equal(parseCadCommand(input, selectedContext).kind, "transaction");
  }
  assert.equal(parseCadCommand("DIM 0,0 300,400", selectedContext).commands[0].entity.type, "dimension");
  assert.equal(parseCadCommand("HATCH 0,0 100,0 100,100", selectedContext).commands[0].entity.type, "hatch");
  assert.match(parseCadCommand("DIST 0,0 300,400", selectedContext).message, /距離=500/);
  assert.match(parseCadCommand("AREA e_box_1", selectedContext).message, /面積=/);
  assert.deepEqual(parseCadCommand("PAN 100,50", selectedContext), { kind: "ui", action: "pan", offset: { x: 100, y: 50 } });
  assert.deepEqual(parseCadCommand("PLOT", selectedContext), { kind: "ui", action: "plot" });
});

test("precision edit commands mirror, array, break and join geometry", () => {
  // 専用の作業線を用意してから精密編集コマンドを検証する(デモ図面の線は分割位置が不明確なため)
  const seed = seedDrawing();
  const source = line("layer-structure", [0, 0], [1000, 0]);
  const created = applyTransaction(seed, {
    source: "user",
    label: "test line",
    commands: [{ op: "add", entity: source }]
  });
  assert.equal(created.ok, true);
  const drawing = created.drawing;
  const lineId = drawing.entities.find((entity) => entity.type === "line" && entity.points[0].x === 0 && entity.points[0].y === 0 && entity.points[1].x === 1000).id;
  const ctx = context({ drawing, selectedId: lineId });

  // MIRROR: y軸(x=0)で反転 → 点列が負側へ置換される
  const mirror = parseCadCommand("MIRROR 0,0 0,100", ctx);
  assert.equal(mirror.kind, "transaction");
  const mirrored = applyTransaction(drawing, { source: "user", label: mirror.label, commands: mirror.commands });
  assert.equal(mirrored.ok, true);
  const afterMirror = mirrored.drawing.entities.find((entity) => entity.id === lineId);
  assert.deepEqual(afterMirror.points, [{ x: 0, y: 0 }, { x: -1000, y: 0 }]);

  // ARRAY: 反転済みの線分を2×2(列間隔2000,行間隔1000)で複写 → 3件追加
  // (鏡像後のdrawingへ適用し、コピーの座標が鏡像済み線分から複写されることを確認)
  const array = parseCadCommand("ARRAY 2 2 2000 1000", context({ drawing: mirrored.drawing, selectedId: lineId }));
  const arrayed = applyTransaction(mirrored.drawing, { source: "user", label: array.label, commands: array.commands });
  assert.equal(arrayed.ok, true);
  assert.equal(arrayed.drawing.entities.length, mirrored.drawing.entities.length + 3, "2×2-1=3件の複写");
  const copies = arrayed.drawing.entities.filter((entity) => entity.id.startsWith("e_array_") && entity.points[0].y === 0);
  const copyStarts = copies.map((copy) => copy.points[0].x).sort((a, b) => a - b);
  assert.deepEqual(copyStarts, [2000], "鏡像済み(-1000,0)起点の線の列複写は(2000,0)(元位置はスキップ)");

  // JOINが余分な引数を拒否する
  assert.throws(() => parseCadCommand("JOIN e1 e2 unexpected", context({ drawing: arrayed.drawing })), /引数が多すぎます/);

  // BREAK: 別の作業線を用意し(0,0)-(1000,0)を(500,0)で2分割
  const line2 = line("layer-structure", [0, 2000], [1000, 2000]);
  const withLine2 = applyTransaction(arrayed.drawing, {
    source: "user",
    label: "test line2",
    commands: [{ op: "add", entity: line2 }]
  });
  assert.equal(withLine2.ok, true);
  const line2Id = withLine2.drawing.entities.find((entity) => entity.type === "line" && entity.points[0].y === 2000).id;
  const breakCmd = parseCadCommand("BREAK 500,2000", context({ drawing: withLine2.drawing, selectedId: line2Id }));
  assert.equal(breakCmd.commands[0].op, "delete");
  assert.equal(breakCmd.commands.filter((command) => command.op === "add").length, 2);
  const broken = applyTransaction(withLine2.drawing, { source: "user", label: breakCmd.label, commands: breakCmd.commands });
  assert.equal(broken.ok, true);

  // JOIN: 分割された2線分(同一線上・端点一致)を再結合する
  const pieces = broken.drawing.entities.filter((entity) => entity.type === "line" && entity.points[0].y === 2000);
  assert.equal(pieces.length, 2);
  const joinCmd = parseCadCommand(`JOIN ${pieces[0].id} ${pieces[1].id}`, context({ drawing: broken.drawing }));
  const joined = applyTransaction(broken.drawing, { source: "user", label: joinCmd.label, commands: joinCmd.commands });
  assert.equal(joined.ok, true);
  const joinedPieces = joined.drawing.entities.filter((entity) => entity.type === "line" && entity.points[0].y === 2000);
  assert.equal(joinedPieces.length, 1, "2線分が1本へ結合される");
  assert.deepEqual(joinedPieces[0].points, [{ x: 0, y: 2000 }, { x: 1000, y: 2000 }]);
});
