import test from "node:test";
import assert from "node:assert/strict";
import { createDrawing, applyTransaction, line } from "../src/cad-core.js";
import { parseCadImport } from "../src/importers.js";
import { exportDxf } from "../src/dxf-export.js";
import { transformEntity } from "../src/cad-advanced.js";
import { nativeBlockDrawing } from "./fixtures/native-block.js";
import { createDxfSourceDocument, inspectDxfBlocks, patchDxfSourceValues } from "../src/dxf-source-document.js";
import { blockReference } from "../src/cad-block.js";

function imported(content, filename = "sample.dxf") {
  const drawing = createDrawing();
  const parsed = parseCadImport({ filename, content, drawing, currentLayerId: drawing.layers[0].id });
  const result = applyTransaction(drawing, { commands: parsed.commands });
  assert.equal(result.ok, true, result.error);
  return result.drawing;
}

function source(eol = "\n") {
  const raw = exportDxf(nativeBlockDrawing()).content;
  return raw.replace("0\nEOF", "0\nSECTION\n2\nOBJECTS\n0\nDICTIONARY\n5\nFAFF\n100\nAcDbDictionary\n281\n1\n0\nENDSEC\n0\nEOF").replaceAll("\n", eol);
}

test("unedited export preserves the exact original, including BOM, newline variants and opaque objects", () => {
  for (const eol of ["\n", "\r\n", "\r"]) {
    const content = "\uFEFF" + source(eol) + eol;
    const drawing = imported(content);
    const result = exportDxf(drawing);
    assert.equal(result.content, content);
    assert.equal(result.preservation?.mode, "source-patch");
    assert.equal(result.preservation.changedGroups, 0);
    const reloaded = imported(JSON.stringify(drawing), "drawing.json");
    assert.equal(exportDxf(reloaded).content, content);
  }
});

test("INSERT transform and duplicate-tag value edit patch only entity values; source remains immutable", () => {
  const content = source("\r\n");
  const drawing = imported(content);
  const reference = drawing.entities[1];
  const patch = transformEntity(reference, { dx: 30, dy: -40, angle: 15, scale: 1.2 });
  patch.attributeReferences[1].value = "更新B";
  const result = applyTransaction(drawing, { commands: [{ op: "update", id: reference.id, patch }] });
  assert.equal(result.ok, true, result.error);
  const output = exportDxf(result.drawing);
  assert.equal(output.preservation?.mode, "source-patch", output.warnings.join(" / "));
  assert.ok(output.preservation.changedGroups > 0);
  const section = (text, name) => text.split(`2\r\n${name}\r\n`)[1].split("0\r\nENDSEC")[0];
  for (const name of ["HEADER", "TABLES", "BLOCKS", "OBJECTS"]) assert.equal(section(output.content, name), section(content, name));
  const reimported = imported(output.content);
  assert.deepEqual(reimported.entities[1].insertion, patch.insertion);
  assert.deepEqual(reimported.entities[1].attributeReferences.map((a) => a.value), ["測点A", "更新B"]);
  assert.equal(result.drawing.dxfSources[0].source, content);
});

test("missing default INSERT rotation can be inserted without rebuilding TABLES or OBJECTS", () => {
  const content = source().replace("43\n1\n50\n0\n66", "43\n1\n66");
  const drawing = imported(content);
  drawing.entities[1].rotation = 25;
  const output = exportDxf(drawing);
  assert.equal(output.preservation?.mode, "source-patch", output.warnings.join(" / "));
  assert.equal(imported(output.content).entities[1].rotation, 25);
});

test("mirrored and nonuniform INSERT edits retain source sections and signed scales", () => {
  const content = source();
  const drawing = imported(content);
  const reference = drawing.entities[1];
  reference.axisScale = { x: -2, y: 3 };
  reference.scaleZ = -4;
  const output = exportDxf(drawing);
  assert.equal(output.preservation?.mode, "source-patch", output.warnings.join(" / "));
  const reloaded = imported(output.content);
  assert.deepEqual(reloaded.entities[1].axisScale, { x: -2, y: 3 });
  assert.equal(reloaded.entities[1].scaleZ, -4);
});

test("add/delete and existing BLOCK definition geometry edits preserve opaque source sections", () => {
  const content = source("\r\n");
  const drawing = imported(content);
  drawing.entities.pop();
  const added = structuredClone(drawing.entities[0]);
  added.id = "added-reference";
  delete added.dxfRecordId;
  added.insertion = { x: 700, y: 800 };
  drawing.entities.push(added);
  const definition = drawing.blockDefinitions.find((item) => item.name === "INNER");
  definition.entities[0].points[1].x = 175;
  definition.entities.pop();
  definition.entities.push({ ...structuredClone(definition.entities[0]), id: "new-child", dxfRecordId: undefined, points: [{ x: 10, y: 30 }, { x: 90, y: 30 }] });
  const output = exportDxf(drawing);
  assert.equal(output.preservation?.mode, "source-patch");
  assert.equal(output.preservation.removedRecords, 5); // INSERT + 2 ATTRIB + SEQEND, plus one definition entity.
  assert.equal(output.preservation.insertedRecords, 2);
  const objects = (text) => text.split("2\r\nOBJECTS\r\n")[1].split("0\r\nENDSEC")[0];
  assert.equal(objects(output.content), objects(content));
  const reloaded = imported(output.content);
  assert.equal(reloaded.entities.length, 2);
  assert.deepEqual(reloaded.entities[1].insertion, { x: 700, y: 800 });
  const reloadedDefinition = reloaded.blockDefinitions.find((item) => item.name === "INNER");
  assert.equal(reloadedDefinition.entities.length, 2);
  assert.equal(reloadedDefinition.entities[0].points[1].x, 175);
  assert.deepEqual(reloadedDefinition.entities[1].points, [{ x: 10, y: 30 }, { x: 90, y: 30 }]);
});

test("new, renamed and removed BLOCK definitions update BLOCK_RECORD without rebuilding OBJECTS", () => {
  const content = source();
  const addedDrawing = imported(content);
  const template = addedDrawing.blockDefinitions.find((item) => item.name === "INNER");
  const addedDefinition = structuredClone(template);
  addedDefinition.id = "added-definition";
  addedDefinition.name = "ADDED_DEFINITION";
  delete addedDefinition.dxfRecordId;
  addedDefinition.entities = addedDefinition.entities.map((entity, index) => ({ ...entity, id: `added-child-${index}`, dxfRecordId: undefined }));
  addedDrawing.blockDefinitions.push(addedDefinition);
  addedDrawing.entities.push(blockReference(addedDrawing.entities[0].layerId, addedDefinition.id, { x: 900, y: 900 }));
  let output = exportDxf(addedDrawing);
  assert.equal(output.preservation?.mode, "source-patch");
  assert.equal(output.preservation.insertedRecords, 3);
  let reloaded = imported(output.content);
  assert.ok(reloaded.blockDefinitions.some((item) => item.name === "ADDED_DEFINITION"));
  assert.ok(reloaded.entities.some((item) => item.name === "ADDED_DEFINITION"));

  const renamedDrawing = imported(content);
  renamedDrawing.blockDefinitions.find((item) => item.name === "INNER").name = "RENAMED_INNER";
  output = exportDxf(renamedDrawing);
  assert.equal(output.preservation?.mode, "source-patch", output.warnings.join(" / "));
  reloaded = imported(output.content);
  assert.ok(reloaded.blockDefinitions.some((item) => item.name === "RENAMED_INNER"));
  assert.equal(reloaded.entities[1].name, "RENAMED_INNER");

  const removedDrawing = imported(content);
  const outer = removedDrawing.blockDefinitions.find((item) => item.name === "OUTER");
  removedDrawing.entities = removedDrawing.entities.filter((item) => item.definitionId !== outer.id);
  removedDrawing.blockDefinitions = removedDrawing.blockDefinitions.filter((item) => item.id !== outer.id);
  output = exportDxf(removedDrawing);
  assert.equal(output.preservation?.mode, "source-patch");
  reloaded = imported(output.content);
  assert.ok(!reloaded.blockDefinitions.some((item) => item.name === "OUTER"));
});

test("layer/layout/unit and record reordering never claim source preservation", () => {
  for (const mutate of [
    (d) => d.entities.push({ ...d.entities[0], id: "copy" }),
    (d) => d.entities.reverse(),
    (d) => { d.layers[0].color = "#ffffff"; },
    (d) => { d.layout.scale = 50; },
    (d) => { d.unit = "m"; },
    (d) => { d.entities[1].dxfRecordId = d.entities[0].dxfRecordId; }
  ]) {
    const drawing = imported(source());
    mutate(drawing);
    const output = exportDxf(drawing);
    assert.equal(output.preservation, undefined);
    assert.match(output.warnings.join(" "), /限定再生成/);
  }
});

test("plain DXF keeps its source while existing primitives change and new primitives append in order", () => {
  const base = createDrawing();
  base.entities = [line(base.layers[0].id, [0, 0], [100, 0]), line(base.layers[0].id, [0, 10], [100, 10])];
  const content = exportDxf(base).content.replace("0\nEOF", "0\nSECTION\n2\nOBJECTS\n0\nDICTIONARY\n5\nFACE\n100\nAcDbDictionary\n281\n1\n0\nENDSEC\n0\nEOF");
  const drawing = imported(content);
  assert.equal(drawing.dxfSources[0].source, content);
  drawing.entities[0].points[1].x = 150;
  drawing.entities.push(line(drawing.layers[0].id, [0, 20], [100, 20]), line(drawing.layers[0].id, [0, 30], [100, 30]));
  const output = exportDxf(drawing);
  assert.equal(output.preservation?.mode, "source-patch");
  assert.equal(output.preservation.insertedRecords, 2);
  assert.match(output.content, /5\nFACE/);
  const reloaded = imported(output.content);
  assert.deepEqual(reloaded.entities.map((entity) => entity.points), [
    [{ x: 0, y: 0 }, { x: 150, y: 0 }], [{ x: 0, y: 10 }, { x: 100, y: 10 }],
    [{ x: 0, y: 20 }, { x: 100, y: 20 }], [{ x: 0, y: 30 }, { x: 100, y: 30 }]
  ]);
});

test("source patch rejects group injection, duplicate writes and handle edits", () => {
  const document = createDxfSourceDocument(source());
  const recordId = inspectDxfBlocks(document).references[0].recordId;
  const patch = { recordId, code: 50, value: 10 };
  for (const patches of [[{ ...patch, value: "0\n0\nEOF" }], [patch, patch], [{ ...patch, code: 5 }]]) {
    assert.throws(() => patchDxfSourceValues(document, patches));
  }
});

test("deletion falls back instead of leaving an opaque dangling handle reference", () => {
  const content = source().replace("2\nENTITIES\n0\nINSERT", "2\nENTITIES\n0\nINSERT\n5\nABCD").replace("281\n1\n0\nENDSEC", "281\n1\n330\nABCD\n0\nENDSEC");
  const drawing = imported(content);
  drawing.entities.shift();
  const output = exportDxf(drawing);
  assert.equal(output.preservation, undefined);
  assert.match(output.warnings.join(" "), /限定再生成/);
});
