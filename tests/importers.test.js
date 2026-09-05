import test from "node:test";
import assert from "node:assert/strict";
import { applyTransaction, seedDrawing } from "../src/cad-core.js";
import { parseCadImport } from "../src/importers.js";

test("DXF preflight rejects unsupported records atomically before parser loss", () => {
  for (const type of ["HATCH", "LEADER", "VIEWPORT", "DIMENSION", "INSERT", "ACAD_PROXY_ENTITY", "CUSTOM_ENTITY", "__proto__"]) {
    const drawing = seedDrawing(), before = structuredClone(drawing);
    const content = ["0", "SECTION", "2", "ENTITIES", "0", "LINE", "10", "0", "20", "0", "11", "1", "21", "1", "0", type, "0", "ENDSEC", "0", "EOF"].join("\n");
    assert.throws(() => parseCadImport({ filename: "mixed.dxf", content, drawing, currentLayerId: "layer-structure" }), (error) => error.message.includes(`${type} 1件`) && error.message.includes("図面は変更していません"));
    assert.deepEqual(drawing, before);
  }
});

test("DXF preflight rejects malformed supported entities without partial commands", () => {
  const drawing = seedDrawing();
  const content = "0\nSECTION\n2\nENTITIES\n0\nLINE\n10\n0\n20\n0\n11\n1\n21\n1\n0\nCIRCLE\n10\n5\n20\n5\n40\n-1\n0\nENDSEC\n0\nEOF";
  assert.throws(() => parseCadImport({ filename: "invalid.dxf", content, drawing, currentLayerId: "layer-structure" }), /変換不能Entity 1件/);
});

test("DXF original entity limit applies before unsupported records disappear", () => {
  const content = `0\nSECTION\n2\nENTITIES\n${"0\nHATCH\n".repeat(10001)}0\nENDSEC\n0\nEOF`;
  assert.throws(() => parseCadImport({ filename: "large.dxf", content, drawing: seedDrawing() }), /10000件まで/);
});

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
    "0", "ARC", "8", "DXF-ARC", "10", "500", "20", "600", "40", "75", "50", "350", "51", "20",
    "0", "ENDSEC", "0", "EOF"
  ].join("\n");
  const imported = parseCadImport({
    filename: "sample.dxf",
    content: dxf,
    drawing,
    currentLayerId: "layer-structure"
  });
  assert.equal(imported.entityCount, 3);
  assert.equal(imported.commands.filter((command) => command.op === "add_layer").length, 3);
  assert.deepEqual(
    imported.commands.filter((command) => command.op === "add").map((command) => command.entity.type),
    ["line", "circle", "arc"]
  );
  const importedArc = imported.commands.find((command) => command.entity?.type === "arc").entity;
  assert.ok(Math.abs(importedArc.startAngle - 350) < 1e-9);
  assert.ok(Math.abs(importedArc.endAngle - 20) < 1e-9);
});

test("JSON imports native arc without flattening it to a polyline", () => {
  const drawing = seedDrawing();
  const imported = parseCadImport({
    filename: "arc.json",
    content: JSON.stringify({ entities: [{ type: "arc", center: { x: 300, y: 400 }, radius: 80, startAngle: 45, endAngle: 225 }] }),
    drawing,
    currentLayerId: "layer-structure"
  });
  const entity = imported.commands.find((command) => command.op === "add").entity;
  assert.equal(entity.type, "arc");
  assert.deepEqual(entity.center, { x: 300, y: 400 });
  assert.equal(entity.radius, 80);
  assert.equal(entity.startAngle, 45);
  assert.equal(entity.endAngle, 225);
});

test("JSON imports native ellipse and spline geometry", () => {
  const drawing = seedDrawing();
  const imported = parseCadImport({
    filename: "curves.json",
    content: JSON.stringify({ entities: [
      { type: "ellipse", center: { x: 300, y: 400 }, radiusX: 80, radiusY: 40, rotation: 15 },
      { type: "spline", controlPoints: [{ x: 0, y: 0 }, { x: 50, y: 100 }, { x: 100, y: 0 }], degree: 2, knots: [0, 0, 0, 1, 1, 1] }
    ] }),
    drawing,
    currentLayerId: "layer-structure"
  });
  const entities = imported.commands.filter((command) => command.op === "add").map((command) => command.entity);
  assert.deepEqual(entities.map((entity) => entity.type), ["ellipse", "spline"]);
  assert.equal(entities[0].radiusY, 40);
  assert.deepEqual(entities[1].knots, [0, 0, 0, 1, 1, 1]);
});

test("import rejects unsupported files, invalid JSON, and empty geometry", () => {
  const drawing = seedDrawing();
  const base = { drawing, currentLayerId: "layer-structure" };
  assert.throws(() => parseCadImport({ ...base, filename: "drawing.dwg", content: "binary" }), /対応形式/);
  assert.throws(() => parseCadImport({ ...base, filename: "drawing.json", content: "{" }), /解析/);
  assert.throws(() => parseCadImport({ ...base, filename: "drawing.json", content: '{"entities":[]}' }), /2D図形/);
});
