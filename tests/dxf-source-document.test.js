import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createDxfSourceDocument, restoreDxfSourceDocument, inspectDxfSourceDocument, inspectDxfBlocks } from "../src/dxf-source-document.js";

const fixture = [
  0, "SECTION", 2, "HEADER", 9, "$INSUNITS", 70, 6, 0, "ENDSEC",
  0, "SECTION", 2, "TABLES", 0, "TABLE", 2, "CUSTOM_TABLE", 0, "CUSTOM_RECORD", 5, "AA", 310, "DEADBEEF", 0, "ENDTAB", 0, "ENDSEC",
  0, "SECTION", 2, "BLOCKS",
  0, "BLOCK", 2, "inner", 10, 3, 20, 4, 30, 5,
  0, "ATTDEF", 2, "CODE", 1, "default", 3, "Label", 70, 3, 10, 2, 40, 0.1,
  0, "CIRCLE", 40, 10, 0, "ENDBLK",
  0, "BLOCK", 2, "outer", 0, "INSERT", 2, "inner", 41, -2, 42, 3, 43, 4, 50, 45, 0, "ENDBLK", 0, "ENDSEC",
  0, "SECTION", 2, "ENTITIES",
  0, "INSERT", 2, "OUTER", 5, "BB", 66, 1, 10, 100, 20, 200, 67, 1, 410, "Layout1", 70, 2, 71, 3, 44, 4, 45, 5,
  0, "ATTRIB", 2, "CODE", 1, " first ", 10, 100, 40, 2, 70, 1,
  0, "ATTRIB", 2, "CODE", 1, "second", 10, 101, 40, 3,
  0, "SEQEND", 0, "ACAD_PROXY_ENTITY", 310, "00FF", 0, "ENDSEC",
  0, "SECTION", 2, "OBJECTS", 0, "DICTIONARY", 5, "DD", 330, "0", 3, "Custom", 350, "EE",
  0, "CUSTOM_OBJECT", 5, "EE", 330, "DD", 1000, "opaque", 0, "ENDSEC", 0, "EOF"
].join("\n");

test("source JSON retains unknown records, tables, objects, whitespace and line endings exactly", () => {
  for (const source of [fixture, fixture + "\n", "\uFEFF" + fixture.replaceAll("\n", "\r\n") + "\r\n", fixture.replaceAll("\n", "\r")]) {
    const document = JSON.parse(JSON.stringify(createDxfSourceDocument(source)));
    assert.equal(restoreDxfSourceDocument(document), source);
    const view = inspectDxfSourceDocument(document);
    assert.deepEqual(view.sections.map((section) => section.name), ["HEADER", "TABLES", "BLOCKS", "ENTITIES", "OBJECTS"]);
    assert.equal(view.records.filter((record) => record.type === "ACAD_PROXY_ENTITY").length, 1);
    view.records[0].groups.length = 0;
    assert.equal(restoreDxfSourceDocument(document), source, "semantic inspection is not an editable export");
  }
});

test("block source model separates definitions and references without flattening or collapsing attribute tags", () => {
  const { definitions, references, diagnostics } = inspectDxfBlocks(createDxfSourceDocument(fixture));
  assert.deepEqual(diagnostics, []);
  assert.equal(definitions.length, 2);
  assert.deepEqual(definitions[0].basePoint, { x: 3, y: 4, z: 5 });
  assert.equal(definitions[0].attributeDefinitions[0].flags, 3);
  assert.equal(definitions[0].attributeDefinitions[0].prompt, "Label");
  assert.equal(references[0].containerRecordId, definitions[1].recordId);
  assert.equal(references[0].definitionRecordId, definitions[0].recordId);
  assert.deepEqual(references[0].scale, { x: -2, y: 3, z: 4 });
  assert.equal(references[0].rotation, 45);
  assert.equal(references[1].definitionRecordId, definitions[1].recordId);
  assert.equal(references[1].layout, "Layout1");
  assert.equal(references[1].paperSpace, 1);
  assert.equal(references[1].columns, 2);
  assert.equal(references[1].rows, 3);
  assert.deepEqual(references[1].attributes.map((attribute) => attribute.value), [" first ", "second"]);
});

test("missing references are diagnosed, but source can still be recovered", () => {
  const source = fixture.replace("2\nOUTER", "2\nmissing");
  const document = createDxfSourceDocument(source);
  assert.match(inspectDxfBlocks(document).diagnostics.join(" "), /Missing BLOCK missing/);
  assert.equal(restoreDxfSourceDocument(document), source);
});

test("block owner excludes reactor handles and malformed numeric views do not prevent archival", () => {
  const source = fixture.replace("2\ninner\n10", "2\ninner\n102\n{ACAD_REACTORS\n330\nREACTOR\n102\n}\n330\nOWNER\n10");
  assert.equal(inspectDxfBlocks(createDxfSourceDocument(source)).definitions[0].owner, "OWNER");
  const malformed = source.replace("41\n-2", "41\nnot-a-number");
  const document = createDxfSourceDocument(malformed);
  assert.throws(() => inspectDxfBlocks(document), /Invalid numeric group/);
  assert.equal(restoreDxfSourceDocument(document), malformed);
});

test("malformed structure and unsupported archive versions fail explicitly", () => {
  for (const source of ["", "0\nSECTION\n2", fixture.replace("0\nENDSEC", "0\nEOF"), fixture + "\n0\nLINE", fixture.replace("0\nEOF", "")]) {
    assert.throws(() => createDxfSourceDocument(source));
  }
  assert.throws(() => restoreDxfSourceDocument({ format: "mirai-dxf-source", version: 2, source: fixture }), /Unsupported/);
});

test("archive CLI verifies source bytes, restores exclusively, and rejects tampering and invalid encoding", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "mirai-source-"));
  const output = path.join(dir, "archives");
  const run = (...args) => spawnSync(process.execPath, ["scripts/dxf-source-archive.mjs", ...args], { encoding: "utf8" });
  try {
    const source = Buffer.from("\uFEFF" + fixture.replaceAll("\n", "\r\n"));
    await writeFile(path.join(dir, "input.dxf"), source);
    assert.equal(run("pack", dir, output).status, 0);
    const archivePath = path.join(output, "input.dxf.source.json");
    const restored = path.join(dir, "restored.dxf");
    assert.equal(run("restore", archivePath, restored).status, 0);
    assert.deepEqual(await readFile(restored), source);
    assert.equal(run("restore", archivePath, restored).status, 1);
    const archive = JSON.parse(await readFile(archivePath, "utf8"));
    archive.document.source = archive.document.source.replace("default", "changed");
    await writeFile(archivePath, JSON.stringify(archive));
    assert.match(run("restore", archivePath, path.join(dir, "bad.dxf")).stderr, /checksum mismatch/);
    await writeFile(path.join(dir, "invalid.dxf"), Buffer.from([255]));
    assert.equal(run("pack", dir, output).status, 1);
    const report = JSON.parse(await readFile(path.join(output, "report.json"), "utf8"));
    assert.equal(report.editableCompatibilityCertified, false);
    assert.equal(report.results.find((item) => item.file === "invalid.dxf").preserved, false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
