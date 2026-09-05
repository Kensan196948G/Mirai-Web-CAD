import test from "node:test";
import assert from "node:assert/strict";
import { createDrawing, applyTransaction } from "../src/cad-core.js";
import { parseCadImport } from "../src/importers.js";
import { exportDxf } from "../src/dxf-export.js";
import { transformEntity } from "../src/cad-advanced.js";
import { nativeBlockDrawing } from "./fixtures/native-block.js";
import { createDxfSourceDocument, inspectDxfBlocks, patchDxfSourceValues } from "../src/dxf-source-document.js";

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
  assert.equal(output.preservation?.mode, "source-patch");
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
  assert.equal(output.preservation?.mode, "source-patch");
  assert.equal(imported(output.content).entities[1].rotation, 25);
});

test("copies, deleted references, definition/layer/layout/unit/attribute geometry changes never claim source preservation", () => {
  for (const mutate of [
    (d) => d.entities.push({ ...d.entities[0], id: "copy" }),
    (d) => d.entities.pop(),
    (d) => d.entities.reverse(),
    (d) => { d.blockDefinitions[0].entities[0].points[0].x++; },
    (d) => { d.layers[0].color = "#ffffff"; },
    (d) => { d.layout.scale = 50; },
    (d) => { d.unit = "m"; },
    (d) => { d.entities[1].attributeReferences[0].at.x++; },
    (d) => { d.entities[1].dxfRecordId = d.entities[0].dxfRecordId; }
  ]) {
    const drawing = imported(source());
    mutate(drawing);
    const output = exportDxf(drawing);
    assert.equal(output.preservation, undefined);
    assert.match(output.warnings.join(" "), /限定再生成/);
  }
});

test("source patch rejects group injection, duplicate writes and handle edits", () => {
  const document = createDxfSourceDocument(source());
  const recordId = inspectDxfBlocks(document).references[0].recordId;
  const patch = { recordId, code: 50, value: 10 };
  for (const patches of [[{ ...patch, value: "0\n0\nEOF" }], [patch, patch], [{ ...patch, code: 5 }]]) {
    assert.throws(() => patchDxfSourceValues(document, patches));
  }
});
