import test from "node:test";
import assert from "node:assert/strict";
import { applyTransaction, seedDrawing } from "../src/cad-core.js";
import { parseCadImport } from "../src/importers.js";

test("JSON export geometry imports through add-layer and add commands", () => {
  const drawing = seedDrawing();
  const source = {
    layers: [{ id: "survey", name: "測量", color: "#224466" }],
    entities: [
      { type: "line", layerId: "survey", points: [{ x: 10, y: 20 }, { x: 30, y: 40 }] },
      { type: "circle", layerId: "survey", center: { x: 50, y: 60 }, radius: 15 }
    ]
  };
  const imported = parseCadImport({
    filename: "survey.json",
    content: JSON.stringify(source),
    drawing,
    currentLayerId: "layer-structure"
  });
  assert.equal(imported.entityCount, 2);
  assert.equal(imported.commands[0].op, "add_layer");
  const result = applyTransaction(drawing, { source: "user", label: "JSON import", commands: imported.commands });
  assert.equal(result.ok, true);
  assert.equal(result.drawing.layers.some((layer) => layer.name === "測量"), true);
  assert.equal(result.drawing.entities.length, drawing.entities.length + 2);
});

test("ASCII DXF imports supported 2D entities and reports unsupported entities", () => {
  const drawing = seedDrawing();
  const dxf = [
    "0", "SECTION", "2", "ENTITIES",
    "0", "LINE", "8", "DXF-LINE", "10", "10", "20", "20", "11", "110", "21", "120",
    "0", "CIRCLE", "8", "DXF-CIRCLE", "10", "200", "20", "300", "40", "25",
    "0", "ENDSEC", "0", "EOF"
  ].join("\n");
  const imported = parseCadImport({
    filename: "sample.dxf",
    content: dxf,
    drawing,
    currentLayerId: "layer-structure"
  });
  assert.equal(imported.entityCount, 2);
  assert.equal(imported.commands.filter((command) => command.op === "add_layer").length, 2);
  assert.deepEqual(
    imported.commands.filter((command) => command.op === "add").map((command) => command.entity.type),
    ["line", "circle"]
  );
});

test("import rejects unsupported files, invalid JSON, and empty geometry", () => {
  const drawing = seedDrawing();
  const base = { drawing, currentLayerId: "layer-structure" };
  assert.throws(() => parseCadImport({ ...base, filename: "drawing.dwg", content: "binary" }), /対応形式/);
  assert.throws(() => parseCadImport({ ...base, filename: "drawing.json", content: "{" }), /解析/);
  assert.throws(() => parseCadImport({ ...base, filename: "drawing.json", content: '{"entities":[]}' }), /2D図形/);
});
