import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const CLI = path.resolve("scripts/compat-report.mjs");

async function withTempDir(run) {
  const dir = await mkdtemp(path.join(tmpdir(), "compat-report-"));
  try {
    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("dxf-roundtrip mode requires --file and scores a lossless export/reimport cycle", async () => {
  await assert.rejects(execFileAsync("node", [CLI, "--mode=dxf-roundtrip"]), (error) => {
    assert.equal(error.code, 1);
    assert.match(error.stderr, /--file/);
    return true;
  });
  await withTempDir(async (dir) => {
    const file = path.join(dir, "sample.dxf");
    await writeFile(
      file,
      [
        "0", "SECTION", "2", "ENTITIES",
        "0", "LINE", "8", "DXF-LINE", "10", "10", "20", "20", "11", "110", "21", "120",
        "0", "CIRCLE", "8", "DXF-CIRCLE", "10", "200", "20", "300", "40", "25",
        "0", "ENDSEC", "0", "EOF"
      ].join("\n")
    );
    const { stdout } = await execFileAsync("node", [CLI, "--mode=dxf-roundtrip", `--file=${file}`]);
    const body = JSON.parse(stdout);
    assert.equal(body.mode, "dxf-roundtrip");
    assert.equal(body.totals.missing, 0);
    assert.equal(body.totals.extra, 0);
    assert.ok(body.score >= 0.95, `score=${body.score}`);
    // 各段階の診断はimportWarningsへ混在させず、別フィールドで構造化出力する(CodeRabbit Major対応)
    assert.ok(Array.isArray(body.firstImportWarnings));
    assert.ok(Array.isArray(body.secondImportWarnings));
    assert.ok(Array.isArray(body.exportSkipped));
    assert.ok(Array.isArray(body.exportWarnings));
  });
});

test("json-roundtrip mode scores a perfect match for a simple import file", async () => {
  await withTempDir(async (dir) => {
    const file = path.join(dir, "sample.json");
    await writeFile(
      file,
      JSON.stringify({
        layers: [{ id: "survey", name: "測量", color: "#224466" }],
        entities: [{ type: "circle", layerId: "survey", center: { x: 100, y: 100 }, radius: 50 }]
      })
    );
    const { stdout } = await execFileAsync("node", [CLI, "--mode=json-roundtrip", `--file=${file}`]);
    const body = JSON.parse(stdout);
    assert.equal(body.score, 1);
    assert.equal(body.grade, "pass90");
    assert.equal(body.totals.missing, 0);
  });
});

test("calibration mode never reports a grade or a pass/fail exit code even when differences would exist", async () => {
  await withTempDir(async (dir) => {
    const file = path.join(dir, "sample.json");
    await writeFile(
      file,
      JSON.stringify({
        layers: [{ id: "survey", name: "測量", color: "#224466" }],
        entities: [{ type: "circle", layerId: "survey", center: { x: 100, y: 100 }, radius: 50 }]
      })
    );
    const { stdout } = await execFileAsync("node", [CLI, "--mode=calibration", `--file=${file}`]);
    const body = JSON.parse(stdout);
    assert.equal(body.mode, "calibration");
    assert.equal("grade" in body, false);
    assert.ok("distribution" in body);
  });
});
