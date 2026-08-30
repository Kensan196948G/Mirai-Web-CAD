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

test("dxf-roundtrip mode always reports unavailable and never returns a passing score", async () => {
  await assert.rejects(execFileAsync("node", [CLI, "--mode=dxf-roundtrip"]), (error) => {
    assert.equal(error.code, 2);
    assert.match(error.stderr, /DXF書出し未実装/);
    assert.doesNotMatch(error.stdout ?? "", /"grade"/);
    return true;
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
