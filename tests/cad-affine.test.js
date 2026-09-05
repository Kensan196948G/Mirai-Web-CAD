import test from "node:test";
import assert from "node:assert/strict";
import { affineEntity, affinePoint, affineText, blockAffine, composeAffine, inverseAffine, textAffine } from "../src/cad-affine.js";

const close = (actual, expected, tolerance = 1e-8) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);
const closePoint = (actual, expected) => { close(actual.x, expected.x); close(actual.y, expected.y); };

test("signed nonuniform BLOCK matrices have stable inverses", () => {
  const matrix = blockAffine({ insertion: { x: 12, y: -7 }, rotation: 31, scale: 2, axisScale: { x: -1.5, y: 0.75 } });
  const identity = composeAffine(matrix, inverseAffine(matrix));
  [1, 0, 0, 1, 0, 0].forEach((expected, index) => close(identity[index], expected));
});

test("text width, oblique and mirror flags survive affine decomposition", () => {
  const original = { type: "text", at: { x: 4, y: 8 }, value: "A", size: 2.5, rotation: 17, widthFactor: 0.8, oblique: 12, generationFlags: 2 };
  const matrix = blockAffine({ insertion: { x: 20, y: 30 }, rotation: -23, scale: 1, axisScale: { x: -2, y: 3 } });
  const transformed = affineText(original, matrix);
  const restored = affineText(transformed, inverseAffine(matrix));
  const actual = textAffine(restored), expected = textAffine(original);
  expected.forEach((value, index) => close(actual[index], value));
});

test("mirrored nonuniform ARC becomes an ELLIPSE arc with matching endpoints", () => {
  const arc = { type: "arc", center: { x: 1, y: 2 }, radius: 3, startAngle: 20, endAngle: 140 };
  const matrix = blockAffine({ insertion: { x: 10, y: -5 }, rotation: 35, scale: 1, axisScale: { x: -2, y: 0.5 } });
  const result = affineEntity(arc, matrix);
  assert.equal(result.type, "ellipse");
  const sourcePoint = (angle) => ({ x: arc.center.x + arc.radius*Math.cos(angle*Math.PI/180), y: arc.center.y + arc.radius*Math.sin(angle*Math.PI/180) });
  const ellipsePoint = (parameter) => {
    const rotation = result.rotation*Math.PI/180;
    return { x: result.center.x + result.radiusX*Math.cos(parameter)*Math.cos(rotation) - result.radiusY*Math.sin(parameter)*Math.sin(rotation),
      y: result.center.y + result.radiusX*Math.cos(parameter)*Math.sin(rotation) + result.radiusY*Math.sin(parameter)*Math.cos(rotation) };
  };
  closePoint(ellipsePoint(result.startParameter), affinePoint(matrix, sourcePoint(arc.endAngle)));
  closePoint(ellipsePoint(result.endParameter), affinePoint(matrix, sourcePoint(arc.startAngle)));
});
