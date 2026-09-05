#!/usr/bin/env node
import { readdir, readFile, mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import DxfParser from "dxf-parser";

const input = path.resolve(process.argv[2] ?? "sample/DXF_sample_set");
const output = path.resolve(process.argv[3] ?? "artifacts/dxf-samples");
const runner = fileURLToPath(new URL("./compat-report.mjs", import.meta.url));

try {
  const files = (await readdir(input, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && /\.dxf$/i.test(entry.name)).map((entry) => entry.name).sort();
  if (!files.length) throw new Error("No DXF samples found");
  await mkdir(output, { recursive: true });
  const results = [];
  for (const file of files) {
    const result = { file, passed: false };
    try {
      const bytes = await readFile(path.join(input, file));
      result.sha256 = createHash("sha256").update(bytes).digest("hex");
      result.bytes = bytes.length;
      // Reject undecodable input instead of silently replacing Japanese characters.
      const content = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      const parsed = new DxfParser().parseSync(content);
      result.version = parsed.header?.$ACADVER ?? null;
      result.sourceEntities = parsed.entities.length;
      result.sourceTypes = {};
      for (const entity of parsed.entities) result.sourceTypes[entity.type] = (result.sourceTypes[entity.type] ?? 0) + 1;
      result.sourceLayers = Object.keys(parsed.tables?.layer?.layers ?? {}).length;
      result.sourceBlocks = Object.keys(parsed.blocks ?? {}).length;
      const run = spawnSync(process.execPath, [runner, "--mode=dxf-roundtrip", `--file=${path.join(input, file)}`], { encoding: "utf8", timeout: 120000, maxBuffer: 16 * 1024 * 1024 });
      if (run.error) throw run.error;
      if (!run.stdout.trim()) throw new Error(run.stderr || `Roundtrip exited ${run.status}`);
      result.roundtrip = JSON.parse(run.stdout);
      const report = result.roundtrip;
      result.passed = run.status === 0 && report.totals.expectedEntities === result.sourceEntities
        && report.totals.actualEntities === result.sourceEntities
        && [report.firstImportWarnings, report.secondImportWarnings, report.exportSkipped, report.exportWarnings].every((items) => Array.isArray(items) && items.length === 0);
    } catch (error) {
      result.error = error.message;
    }
    results.push(result);
    console.log(`${result.passed ? "PASS" : "FAIL"} ${file}`);
  }
  const report = {
    generatedAt: new Date().toISOString(),
    scope: "Imported-model roundtrip regression only; not original-DXF fidelity, external CAD, print or 100-drawing certification.",
    total: results.length, passed: results.filter((r) => r.passed).length, results
  };
  await writeFile(path.join(output, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  console.log(`${report.passed}/${report.total}: ${path.join(output, "report.json")}`);
  process.exitCode = report.passed === report.total ? 0 : 1;
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
