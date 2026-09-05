import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createDrawing, circle } from "../src/cad-core.js";
import { exportDxf } from "../src/dxf-export.js";

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
    await writeFile(path.join(input, "bad.dxf"), "invalid");
    await writeFile(path.join(input, "encoding.dxf"), new Uint8Array([0xff]));
    assert.equal(run().status, 1);
    report = JSON.parse(await readFile(path.join(output, "report.json"), "utf8"));
    assert.equal(report.total, 3);
    assert.equal(report.passed, 1);
    assert.equal(report.results.filter((r) => r.error).length, 2);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
