import test from "node:test";
import assert from "node:assert/strict";
import { parseCadCommand } from "../src/cad-command.js";
import { applyTransaction, seedDrawing } from "../src/cad-core.js";

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
