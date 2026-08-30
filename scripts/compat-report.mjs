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
// 終了コード: 0=成功(pass80以上またはcalibration/explain完了), 1=fail/エラー, 2=未実装モード
import { readFile } from "node:fs/promises";
import { applyTransaction, createDrawing } from "../src/cad-core.js";
import { parseCadImport } from "../src/importers.js";
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
    console.error("DXF書出し未実装(Phase 1 / P1-03a)。ADR-0001参照。dxf-roundtrip比較は現時点で測定できません。");
    return 2;
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

  const serialized = JSON.stringify({ layers: expected.layers, entities: expected.entities });
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

function importInto(base, filename, content) {
  const result = parseCadImport({ filename, content, drawing: base, currentLayerId: base.layers[0]?.id });
  const applied = applyTransaction(base, { source: "system", label: "corpus-import", commands: result.commands });
  if (!applied.ok) throw new Error(`Import適用に失敗しました: ${applied.error}`);
  return { drawing: applied.drawing, warnings: result.warnings };
}

function emitReport(report, { calibration = false, warnings = [] } = {}) {
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
  console.log(
    JSON.stringify(
      {
        mode: report.mode,
        totals: report.totals,
        axisScores: scored.axisScores,
        score: scored.score,
        grade: scored.grade,
        criticalCount: scored.criticalCount,
        blockers: scored.blockers,
        findingCount: report.findings.length,
        importWarnings: warnings
      },
      null,
      2
    )
  );
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
