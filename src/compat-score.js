// src/drawing-compare.jsが返すComparisonReportを採点し、80%/90%/対象外を判定する採点表。
// 許容差・重み・閾値はすべてこのファイルに集約する。実データ到着後の再校正は、この
// ファイルの定数変更のみで完結させ、差分エンジン(drawing-compare.js)は変更しない。
//
// 重要: 以下の数値は80-90%代替方針文書に具体的な記載がないため、CAD製図における一般的な
// 精度慣行(用紙上の実用限界0.1mm程度、電子納品基準系の座標非改変原則、DXF実装の小数出力桁数)
// を踏まえた「初期提案値(v0)」である。実案件図面が到着した後、--mode=calibrationで分布を
// 観測してから閾値を確定すること。閾値を実データより先に固定しない。

export const TOLERANCE_V0 = Object.freeze({
  coordinateAbsolute: 0.01, // mm、絶対許容差
  coordinateRelative: 1e-6, // 図面対角長に対する相対許容差(km規模の路線図での丸め誤差を吸収)
  angle: 0.001, // 度
  margin: 0.01, // mm、レイアウト余白
  strokeWidth: 0.01, // 無次元(現行モデルの線幅表現に合わせる)
  lineDash: 0.01 // mm、破線パターンの各要素
});

// 9軸の重み(合計1.00)。幾何的真実(entity+coordinate)40%、注記系(text+dimension+block)30%、
// 整理系(layer+layout)20%、表現系(linetype+print)10%という配分の初期提案値。
export const AXIS_WEIGHTS = Object.freeze({
  entity: 0.2,
  coordinate: 0.2,
  layer: 0.12,
  text: 0.12,
  dimension: 0.1,
  block: 0.08,
  layout: 0.08,
  linetype: 0.05,
  print: 0.05
});

export const GRADE_THRESHOLDS = Object.freeze({
  pass90: { overall: 0.99, perAxis: 0.95 },
  pass80: { overall: 0.95 }
});

export function scoreComparison(report, options = {}) {
  const axisScores = {};
  let overall = 0;
  for (const [axis, weight] of Object.entries(AXIS_WEIGHTS)) {
    const axisResult = report.axes[axis];
    const score = axisResult?.score ?? 1;
    axisScores[axis] = score;
    overall += score * weight;
  }
  overall = round4(overall);

  const criticalFindings = report.findings.filter((finding) => finding.severity === "critical");
  const blockers = criticalFindings.map((finding) => finding.message);

  const grade = determineGrade(overall, axisScores, criticalFindings.length, options);

  return { score: overall, grade, axisScores, blockers, criticalCount: criticalFindings.length };
}

function determineGrade(overall, axisScores, criticalCount, options) {
  if (options.scope === "out-of-scope") return "out_of_scope";
  if (criticalCount > 0) return "fail";
  const allAxesAbove95 = Object.values(axisScores).every((score) => score >= GRADE_THRESHOLDS.pass90.perAxis);
  if (overall >= GRADE_THRESHOLDS.pass90.overall && allAxesAbove95) return "pass90";
  if (overall >= GRADE_THRESHOLDS.pass80.overall) return "pass80";
  return "fail";
}

export function summarizeCorpus(reports) {
  const passed = reports.filter((entry) => entry.grade === "pass80" || entry.grade === "pass90").length;
  const failed = reports.filter((entry) => entry.grade === "fail").length;
  const excluded = reports.filter((entry) => entry.grade === "out_of_scope").length;
  const blocked = reports.filter((entry) => entry.grade === "blocked").length;
  const measurable = reports.length - excluded - blocked;
  const passRate = measurable === 0 ? null : round4(passed / measurable);

  const byAxis = {};
  for (const axis of Object.keys(AXIS_WEIGHTS)) {
    const scores = reports
      .filter((entry) => entry.axisScores && entry.grade !== "out_of_scope" && entry.grade !== "blocked")
      .map((entry) => entry.axisScores[axis])
      .filter((value) => typeof value === "number");
    byAxis[axis] = scores.length === 0 ? null : round4(scores.reduce((sum, value) => sum + value, 0) / scores.length);
  }

  return { total: reports.length, passed, failed, excluded, blocked, measurable, passRate, byAxis };
}

export function describeRubric() {
  const lines = [];
  lines.push("# 採点表(v0、初期提案値)");
  lines.push("");
  lines.push("実データ到着後の再校正が前提。座標許容差等は方針文書に明記がないため、CAD製図の一般的精度慣行に基づく初期提案値。");
  lines.push("");
  lines.push("## 許容差");
  for (const [key, value] of Object.entries(TOLERANCE_V0)) {
    lines.push(`- ${key}: ${value}`);
  }
  lines.push("");
  lines.push("## 軸別重み(合計1.00)");
  for (const [axis, weight] of Object.entries(AXIS_WEIGHTS)) {
    lines.push(`- ${axis}: ${weight}`);
  }
  lines.push("");
  lines.push("## 合否判定");
  lines.push(`- pass90: 総合スコア ≥ ${GRADE_THRESHOLDS.pass90.overall} かつ 全軸 ≥ ${GRADE_THRESHOLDS.pass90.perAxis} かつ critical 0件`);
  lines.push(`- pass80: 総合スコア ≥ ${GRADE_THRESHOLDS.pass80.overall} かつ critical 0件`);
  lines.push("- out_of_scope: 台帳でscope=out-of-scopeの図面(合格率の分母から除外)");
  lines.push("- fail: 上記以外");
  return lines.join("\n");
}

function round4(value) {
  return Math.round(value * 10000) / 10000;
}
