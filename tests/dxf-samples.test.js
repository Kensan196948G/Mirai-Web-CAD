import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createDrawing, circle } from "../src/cad-core.js";
import { exportDxf } from "../src/dxf-export.js";
import { sourceEntityInventory } from "../scripts/lib/dxf-source-inventory.mjs";

test("source inventory counts unsupported entities before parser loss, excluding child records", () => {
  const content = "0\nSECTION\n2\nBLOCKS\n0\nLINE\n0\nENDSEC\n0\nSECTION\n2\nENTITIES\n0\nHATCH\n0\nPOLYLINE\n0\nVERTEX\n0\nSEQEND\n0\nINSERT\n0\nATTRIB\n0\nSEQEND\n0\nCUSTOM_ENTITY\n0\nENDSEC\n0\nEOF\n";
  assert.deepEqual(sourceEntityInventory(content), { types: { HATCH: 1, POLYLINE: 1, INSERT: 1, CUSTOM_ENTITY: 1 }, children: { VERTEX: 1, SEQEND: 2, ATTRIB: 1 }, total: 4 });
  assert.throws(() => sourceEntityInventory("0\nSECTION\n2"), /Incomplete/);
});

test("sample runner checks every file and fails on malformed or absent input", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "mirai-samples-"));
  const input = path.join(dir, "input"), output = path.join(dir, "output");
  const run = () => spawnSync(process.execPath, ["scripts/check-dxf-samples.mjs", input, output], { encoding: "utf8" });
  try {
    await mkdir(input);
    assert.equal(run().status, 1);
    const drawing = createDrawing({ entities: [10, 20].map((r) => circle("layer-structure", [50, 50], r)) });
    await writeFile(path.join(input, "valid.DXF"), exportDxf(drawing).content);
    assert.equal(run().status, 0);
    let report = JSON.parse(await readFile(path.join(output, "report.json"), "utf8"));
    assert.equal(report.passed, 1);
    assert.equal(report.results[0].sourceTypes.CIRCLE, 2);
    assert.match(report.results[0].sha256, /^[a-f0-9]{64}$/);
    const unsupported = exportDxf(drawing).content.replace(/2\r?\nENTITIES/, "2\nENTITIES\n0\nCUSTOM_ENTITY");
    await writeFile(path.join(input, "unknown.dxf"), unsupported);
    await mkdir(path.join(input, "nested"));
    await writeFile(path.join(input, "nested", "valid.dxf"), exportDxf(drawing).content);
    await writeFile(path.join(input, "bad.dxf"), "invalid");
    await writeFile(path.join(input, "encoding.dxf"), new Uint8Array([0xff]));
    assert.equal(run().status, 1);
    report = JSON.parse(await readFile(path.join(output, "report.json"), "utf8"));
    assert.equal(report.total, 5);
    assert.equal(report.passed, 2);
    assert.equal(report.results.filter((r) => r.error).length, 3);
    assert.equal(report.results.find((r) => r.file === "unknown.dxf").passed, false);
    assert.match(report.results.find((r) => r.file === "unknown.dxf").error, /CUSTOM_ENTITY 1件/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
