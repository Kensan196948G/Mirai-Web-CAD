#!/usr/bin/env node
// 80-90%代替方針Phase 0「比較器と採点表」のCLI。argvパースとファイルI/Oのみを担い、
// 実際の比較・採点ロジックはsrc/drawing-compare.js・src/compat-score.jsの純関数を呼び出す。
//
// 使い方:
//   node scripts/compat-report.mjs --mode=json-roundtrip --file=<import-json>
//   node scripts/compat-report.mjs --mode=dxf-import --file=<dxf> --expected=<expected-drawing-json>
//   node scripts/compat-report.mjs --mode=dxf-roundtrip [--file=<dxf>]
//   node scripts/compat-report.mjs --mode=calibration --file=<import-json|dxf> [--expected=<json>]
//   node scripts/compat-report.mjs --explain
//
// 終了コード: 0=成功(pass80以上またはcalibration/explain完了), 1=fail/エラー
import { readFile } from "node:fs/promises";
import { applyTransaction, createDrawing } from "../src/cad-core.js";
import { parseCadImport } from "../src/importers.js";
import { exportDxf } from "../src/dxf-export.js";
import { compareDrawings } from "../src/drawing-compare.js";
import { TOLERANCE_V0, describeRubric, scoreComparison } from "../src/compat-score.js";

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.explain) {
    console.log(describeRubric());
    return 0;
  }

  const mode = args.mode;
  if (!mode) {
    console.error("エラー: --modeが必要です(json-roundtrip|dxf-import|dxf-roundtrip|calibration)");
    return 1;
  }

  if (mode === "dxf-roundtrip") {
    return await runDxfRoundtrip(args);
  }

  if (mode === "json-roundtrip") {
    return await runJsonRoundtrip(args);
  }

  if (mode === "dxf-import") {
    return await runDxfImport(args, { calibration: false });
  }

  if (mode === "calibration") {
    if (args.expected) return await runDxfImport(args, { calibration: true });
    return await runJsonRoundtrip(args, { calibration: true });
  }

  console.error(`エラー: 未知のmodeです: ${mode}`);
  return 1;
}

async function runJsonRoundtrip(args, { calibration = false } = {}) {
  if (!args.file) {
    console.error("エラー: --fileが必要です");
    return 1;
  }
  const content = await readFile(args.file, "utf8");
  const base = createDrawing();

  const first = importInto(base, args.file, content);
  const expected = first.drawing;

  const serialized = JSON.stringify({ unit: expected.unit, layers: expected.layers, entities: expected.entities });
  const second = importInto(base, "roundtrip.json", serialized);
  const actual = second.drawing;

  const report = compareDrawings(expected, actual, TOLERANCE_V0, { mode: "json-roundtrip" });
  return emitReport(report, { calibration });
}

async function runDxfImport(args, { calibration = false } = {}) {
  if (!args.file || !args.expected) {
    console.error("エラー: --fileと--expectedが必要です");
    return 1;
  }
  const content = await readFile(args.file, "utf8");
  const base = createDrawing();
  const imported = importInto(base, args.file, content);
  const actual = imported.drawing;

  const expectedRaw = await readFile(args.expected, "utf8");
  const expected = JSON.parse(expectedRaw);

  const report = compareDrawings(expected, actual, TOLERANCE_V0, { mode: "dxf-import" });
  return emitReport(report, { calibration, warnings: imported.warnings });
}

// DXF往復比較: 入力DXF→import(期待側)→export→import(実測側)の順で、DXF書出し
// (src/dxf-export.js)がimporters.jsの読み取り能力と整合しているかを9軸採点する。
// 実案件コーパス図面が到着する前の開発回帰ゲートとして機能させる。
async function runDxfRoundtrip(args) {
  if (!args.file) {
    console.error("エラー: dxf-roundtripには--file=<dxf>が必要です");
    return 1;
  }
  const content = await readFile(args.file, "utf8");
  const first = importInto(createDrawing(), args.file, content);
  const expectedDrawing = first.drawing;

  const exported = exportDxf(expectedDrawing);
  const second = importInto(createDrawing(), "roundtrip.dxf", exported.content);
  const actualDrawing = second.drawing;

  const report = compareDrawings(expectedDrawing, actualDrawing, TOLERANCE_V0, { mode: "dxf-roundtrip" });
  return emitReport(report, {
    diagnostics: {
      firstImportWarnings: first.warnings,
      secondImportWarnings: second.warnings,
      exportSkipped: exported.skipped,
      exportWarnings: exported.warnings
    }
  });
}

function importInto(base, filename, content) {
  const result = parseCadImport({ filename, content, drawing: base, currentLayerId: base.layers[0]?.id });
  const applied = applyTransaction(base, { source: "system", label: "corpus-import", commands: result.commands });
  if (!applied.ok) throw new Error(`Import適用に失敗しました: ${applied.error}`);
  return { drawing: applied.drawing, warnings: result.warnings };
}

function emitReport(report, { calibration = false, warnings = [], diagnostics = null } = {}) {
  if (calibration) {
    const deltas = report.findings.map((finding) => finding.delta).filter((value) => typeof value === "number").sort((a, b) => a - b);
    const distribution = {
      count: deltas.length,
      p50: percentile(deltas, 0.5),
      p95: percentile(deltas, 0.95),
      max: deltas.length ? deltas[deltas.length - 1] : null
    };
    console.log(JSON.stringify({ mode: "calibration", totals: report.totals, distribution }, null, 2));
    return 0;
  }

  const scored = scoreComparison(report);
  const output = {
    mode: report.mode,
    totals: report.totals,
    axisScores: scored.axisScores,
    score: scored.score,
    grade: scored.grade,
    criticalCount: scored.criticalCount,
    blockers: scored.blockers,
    findingCount: report.findings.length,
    importWarnings: warnings
  };
  // 往復比較では初回import/再import/export各段階の診断を分離して出力する
  // (skippedは構造化情報のため文字列化せず別フィールドへ保つ)。
  if (diagnostics) {
    output.firstImportWarnings = diagnostics.firstImportWarnings;
    output.secondImportWarnings = diagnostics.secondImportWarnings;
    output.exportSkipped = diagnostics.exportSkipped;
    output.exportWarnings = diagnostics.exportWarnings;
  }
  console.log(JSON.stringify(output, null, 2));
  return scored.grade === "pass80" || scored.grade === "pass90" ? 0 : 1;
}

function percentile(sortedValues, ratio) {
  if (sortedValues.length === 0) return null;
  const index = Math.min(sortedValues.length - 1, Math.floor(sortedValues.length * ratio));
  return sortedValues[index];
}

function parseArgs(argv) {
  const args = {};
  for (const token of argv) {
    if (token === "--explain") {
      args.explain = true;
      continue;
    }
    const match = token.match(/^--([^=]+)=(.*)$/);
    if (match) args[match[1]] = match[2];
  }
  return args;
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error(`エラー: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
