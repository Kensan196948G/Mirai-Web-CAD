import test from "node:test";
import assert from "node:assert/strict";
import { circle, line, seedDrawing } from "../src/cad-core.js";
import { dimensionEntity } from "../src/cad-advanced.js";
import { IGNORED_FIELDS, compareDrawings, pairEntities } from "../src/drawing-compare.js";
import { TOLERANCE_V0 } from "../src/compat-score.js";

test("concentric circles pair by radius after reordering and ID reassignment", () => {
  const expected = seedDrawing();
  expected.entities = [10, 20, 30, 40].map((r, i) => circle("layer-structure", [100, 100], r, { id: `before-${i}` }));
  const actual = structuredClone(expected);
  actual.entities.reverse();
  actual.entities.forEach((e, i) => { e.id = `after-${i}`; });
  const report = compareDrawings(expected, actual, TOLERANCE_V0);
  assert.equal(report.totals.paired, 4);
  assert.equal(report.findings.length, 0);
  actual.entities[0].radius += 1;
  assert.ok(compareDrawings(expected, actual, TOLERANCE_V0).axes.coordinate.score < 1);
});

test("identical concentric circles remain ambiguous rather than silently matched", () => {
  const expected = seedDrawing();
  expected.entities = ["a", "b"].map((id) => circle("layer-structure", [100, 100], 10, { id }));
  const actual = structuredClone(expected);
  actual.entities.forEach((e) => { e.id = `new-${e.id}`; });
  assert.equal(compareDrawings(expected, actual, TOLERANCE_V0).totals.ambiguous, 2);
});

test("compareDrawings gives every axis a perfect score with zero findings for an identical drawing", () => {
  const drawing = seedDrawing();
  const report = compareDrawings(drawing, drawing, TOLERANCE_V0);
  assert.equal(report.findings.length, 0);
  assert.equal(report.totals.missing, 0);
  assert.equal(report.totals.extra, 0);
  for (const axis of Object.values(report.axes)) {
    assert.equal(axis.score, 1);
  }
});

test("compareDrawings treats a coordinate shift within tolerance as passing and beyond tolerance as a finding", () => {
  const expected = seedDrawing();
  const withinTolerance = structuredClone(expected);
  const target = withinTolerance.entities.find((entity) => entity.id === "e_frame_1");
  target.points = target.points.map((point) => ({ x: point.x + TOLERANCE_V0.coordinateAbsolute / 2, y: point.y }));
  const okReport = compareDrawings(expected, withinTolerance, TOLERANCE_V0);
  assert.equal(okReport.axes.coordinate.score, 1);

  const beyondTolerance = structuredClone(expected);
  const target2 = beyondTolerance.entities.find((entity) => entity.id === "e_frame_1");
  target2.points = target2.points.map((point) => ({ x: point.x + 0.5, y: point.y }));
  const badReport = compareDrawings(expected, beyondTolerance, TOLERANCE_V0);
  assert.equal(badReport.axes.coordinate.score < 1, true);
  assert.ok(badReport.findings.some((finding) => finding.code === "coordinate-deviation"));
});

test("compareDrawings detects a missing entity as a critical entity-axis finding", () => {
  const expected = seedDrawing();
  const actual = structuredClone(expected);
  actual.entities = actual.entities.filter((entity) => entity.id !== "e_box_1");
  const report = compareDrawings(expected, actual, TOLERANCE_V0);
  assert.equal(report.totals.missing, 1);
  const finding = report.findings.find((item) => item.code === "entity-missing");
  assert.ok(finding);
  assert.equal(finding.severity, "critical");
  assert.equal(finding.expectedId, "e_box_1");
});

test("compareDrawings detects an unexpected extra entity", () => {
  const expected = seedDrawing();
  const actual = structuredClone(expected);
  actual.entities.push(circle("layer-temporary", [9999, 6999], 10, { id: "e_unexpected" }));
  const report = compareDrawings(expected, actual, TOLERANCE_V0);
  assert.equal(report.totals.extra, 1);
  const finding = report.findings.find((item) => item.code === "entity-extra");
  assert.ok(finding);
  assert.equal(finding.actualId, "e_unexpected");
});

test("compareDrawings pairs entities by geometry even after every id is reassigned, matching import-style re-numbering", () => {
  const expected = seedDrawing();
  const actual = structuredClone(expected);
  actual.entities = actual.entities.map((entity, index) => ({ ...entity, id: `e_reimported_${index}` }));
  const report = compareDrawings(expected, actual, TOLERANCE_V0);
  assert.equal(report.totals.paired, expected.entities.length);
  assert.equal(report.totals.missing, 0);
  assert.equal(report.totals.extra, 0);
  assert.equal(report.axes.entity.score, 1);
});

test("pairEntities keeps a layer-only edit isolated to the layer axis without affecting coordinate score", () => {
  const expected = seedDrawing();
  const actual = structuredClone(expected);
  const layer = actual.layers.find((item) => item.id === "layer-structure");
  layer.printable = false;
  const report = compareDrawings(expected, actual, TOLERANCE_V0);
  assert.equal(report.axes.layer.score < 1, true);
  assert.equal(report.axes.coordinate.score, 1);
  assert.equal(report.axes.entity.score, 1);
});

test("compareDrawings flags a text content change and a text position change with distinct finding codes", () => {
  const expected = seedDrawing();
  const contentChanged = structuredClone(expected);
  contentChanged.entities.find((entity) => entity.id === "e_note_1").value = "changed content";
  const contentReport = compareDrawings(expected, contentChanged, TOLERANCE_V0);
  assert.ok(contentReport.findings.some((finding) => finding.code === "text-content-mismatch"));

  const positionChanged = structuredClone(expected);
  const note = positionChanged.entities.find((entity) => entity.id === "e_note_1");
  note.at = { x: note.at.x + 5, y: note.at.y + 5 };
  const positionReport = compareDrawings(expected, positionChanged, TOLERANCE_V0);
  assert.ok(positionReport.findings.some((finding) => finding.code === "text-position-mismatch"));
});

test("compareDrawings scores dimension offset/precision/suffix independently", () => {
  const expected = seedDrawing();
  expected.entities.push(dimensionEntity("layer-annotation", [0, 0], [1000, 0], { id: "e_dim_1", offset: 200, precision: 1, suffix: "mm" }));
  const actual = structuredClone(expected);
  const dim = actual.entities.find((entity) => entity.id === "e_dim_1");
  dim.suffix = "cm";
  const report = compareDrawings(expected, actual, TOLERANCE_V0);
  assert.ok(report.findings.some((finding) => finding.code === "dimension-suffix-mismatch"));
  assert.equal(report.findings.some((finding) => finding.code === "dimension-offset-mismatch"), false);
});

test("compareDrawings marks an empty line-dash becoming non-empty as a major finding", () => {
  const expected = seedDrawing();
  const actual = structuredClone(expected);
  const target = actual.entities.find((entity) => entity.id === "e_box_1");
  target.style.lineDash = [10, 5];
  const report = compareDrawings(expected, actual, TOLERANCE_V0);
  const finding = report.findings.find((item) => item.code === "linetype-lineDash-mismatch");
  assert.ok(finding);
  assert.equal(finding.severity, "major");
});

test("compareDrawings treats a paper-size change as a critical layout finding", () => {
  const expected = seedDrawing();
  const actual = structuredClone(expected);
  actual.layout.paper = "A4";
  const report = compareDrawings(expected, actual, TOLERANCE_V0);
  const finding = report.findings.find((item) => item.code === "layout-paper-mismatch");
  assert.ok(finding);
  assert.equal(finding.severity, "critical");
});

test("compareDrawings processes a larger synthetic entity set without missing any real match", () => {
  const expected = seedDrawing();
  for (let i = 0; i < 500; i += 1) {
    expected.entities.push(line("layer-temporary", [i * 10, 5000], [i * 10 + 5, 5005], { id: `bulk_${i}` }));
  }
  const actual = structuredClone(expected);
  actual.entities = actual.entities.map((entity, index) => ({ ...entity, id: `reimported_${index}` }));
  const report = compareDrawings(expected, actual, TOLERANCE_V0);
  assert.equal(report.totals.missing, 0);
  assert.equal(report.totals.extra, 0);
  assert.equal(report.totals.ambiguous, 0);
});

test("IGNORED_FIELDS is a frozen reference list documenting fields intentionally excluded from comparison", () => {
  assert.equal(Object.isFrozen(IGNORED_FIELDS), true);
  assert.ok(IGNORED_FIELDS.includes("id"));
  assert.ok(IGNORED_FIELDS.includes("meta.createdAt"));
  assert.ok(IGNORED_FIELDS.includes("commandEvents"));
});

test("pairEntities reports ambiguous-pairing when one expected entity has two equally-close candidates", () => {
  const layerNameById = new Map([["layer-temporary", "仮設"]]);
  const expectedEntities = [circle("layer-temporary", [1000, 1000], 50, { id: "e1" })];
  const actualEntities = [
    circle("layer-temporary", [1000, 1000], 50, { id: "a1" }),
    circle("layer-temporary", [1000, 1000], 50, { id: "a2" })
  ];
  const { pairs, missing, ambiguous } = pairEntities(expectedEntities, actualEntities, layerNameById, layerNameById, 0.01);
  assert.equal(pairs.length, 0);
  assert.equal(missing.length, 1);
  assert.equal(ambiguous.length, 1);
  assert.equal(ambiguous[0].expectedId, "e1");
  assert.deepEqual(ambiguous[0].candidateIds.sort(), ["a1", "a2"]);
});
