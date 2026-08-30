import test from "node:test";
import assert from "node:assert/strict";
import { seedDrawing } from "../src/cad-core.js";
import { compareDrawings } from "../src/drawing-compare.js";
import { AXIS_WEIGHTS, TOLERANCE_V0, describeRubric, scoreComparison, summarizeCorpus } from "../src/compat-score.js";

test("AXIS_WEIGHTS sums to 1.00 and covers exactly the nine documented axes", () => {
  const keys = Object.keys(AXIS_WEIGHTS).sort();
  assert.deepEqual(keys, ["block", "coordinate", "dimension", "entity", "layer", "layout", "linetype", "print", "text"]);
  const total = Object.values(AXIS_WEIGHTS).reduce((sum, value) => sum + value, 0);
  assert.equal(Math.round(total * 100) / 100, 1);
});

test("TOLERANCE_V0 is frozen and pins the initial proposed values so a re-calibration shows up as a diff", () => {
  assert.equal(Object.isFrozen(TOLERANCE_V0), true);
  assert.equal(TOLERANCE_V0.coordinateAbsolute, 0.01);
  assert.equal(TOLERANCE_V0.coordinateRelative, 1e-6);
  assert.equal(TOLERANCE_V0.angle, 0.001);
});

test("scoreComparison grades an identical drawing as pass90 with a perfect score", () => {
  const drawing = seedDrawing();
  const report = compareDrawings(drawing, drawing, TOLERANCE_V0);
  const scored = scoreComparison(report);
  assert.equal(scored.score, 1);
  assert.equal(scored.grade, "pass90");
  assert.equal(scored.criticalCount, 0);
});

test("scoreComparison fails a drawing that has any critical finding regardless of overall score", () => {
  const expected = seedDrawing();
  const actual = structuredClone(expected);
  actual.entities = actual.entities.filter((entity) => entity.id !== "e_note_1");
  const report = compareDrawings(expected, actual, TOLERANCE_V0);
  const scored = scoreComparison(report);
  assert.equal(scored.grade, "fail");
  assert.ok(scored.criticalCount >= 1);
  assert.ok(scored.blockers.length >= 1);
});

test("scoreComparison marks out-of-scope drawings distinctly when the caller passes scope: out-of-scope", () => {
  const drawing = seedDrawing();
  const report = compareDrawings(drawing, drawing, TOLERANCE_V0);
  const scored = scoreComparison(report, { scope: "out-of-scope" });
  assert.equal(scored.grade, "out_of_scope");
});

test("summarizeCorpus returns pass rate, excluded, and blocked counts together and excludes them from the denominator", () => {
  const summary = summarizeCorpus([
    { grade: "pass80", axisScores: { entity: 1, coordinate: 1, layer: 1, block: 1, text: 1, dimension: 1, layout: 1, linetype: 1, print: 1 } },
    { grade: "fail", axisScores: { entity: 0.5, coordinate: 0.5, layer: 1, block: 1, text: 1, dimension: 1, layout: 1, linetype: 1, print: 1 } },
    { grade: "out_of_scope", axisScores: null },
    { grade: "blocked", axisScores: null }
  ]);
  assert.equal(summary.total, 4);
  assert.equal(summary.passed, 1);
  assert.equal(summary.failed, 1);
  assert.equal(summary.excluded, 1);
  assert.equal(summary.blocked, 1);
  assert.equal(summary.measurable, 2);
  assert.equal(summary.passRate, 0.5);
});

test("summarizeCorpus returns a null pass rate when nothing is measurable", () => {
  const summary = summarizeCorpus([{ grade: "out_of_scope", axisScores: null }]);
  assert.equal(summary.measurable, 0);
  assert.equal(summary.passRate, null);
});

test("describeRubric returns human-readable text listing every tolerance and axis weight", () => {
  const text = describeRubric();
  assert.match(text, /coordinateAbsolute/);
  assert.match(text, /entity: 0\.2/);
  assert.match(text, /pass80/);
  assert.match(text, /pass90/);
});
