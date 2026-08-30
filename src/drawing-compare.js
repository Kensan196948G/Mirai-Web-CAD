// 2つの図面(cad-core.jsのDrawing型)を比較し、entity/座標/layer/block/文字/寸法/layout/線種/印刷の
// 9軸で差分を検出する差分エンジン。80-90%代替方針Phase 0「比較器と採点表」の差分エンジン側。
//
// 設計方針: このモジュールは許容差の「値」を知らない(呼び出し側がtoleranceオブジェクトを渡す)。
// 採点ポリシー(閾値・重み・合否判定)はsrc/compat-score.jsに分離してあり、実データ到着後の
// 再校正はcompat-score.js側の定数変更のみで完結する。cad-core.jsのvalidateDrawing・用紙境界
// ハードコード(-1〜12001/-1〜7001)には一切依存しない。
import { entityBounds } from "./cad-core.js";
import { buildSpatialIndex, queryBounds } from "./spatial-index.js";

const EPSILON = 1e-9;
// 図面に1件もentityが無い場合の対角長フォールバック(mm)。validateDrawingの用紙境界定数には
// 依存しない、独立した保守的な既定値。
const EMPTY_DRAWING_DIAGONAL_FALLBACK = 20000;

// 比較から意図的に除外するフィールド(往復のたびに必ず変わる、または比較の対象外)。
// 実際の比較ロジックは軸ごとに明示的な項目のみをチェックするため参照専用だが、
// 「何を意図的に見ていないか」を一箇所に固定してドキュメント化する。
export const IGNORED_FIELDS = Object.freeze([
  "id",
  "meta.createdAt",
  "meta.createdBy",
  "updatedAt",
  "createdAt",
  "revision",
  "version",
  "commandEvents",
  "auditLog",
  "comments"
]);

export function compareDrawings(expected, actual, tolerance, options = {}) {
  const layerNameByIdExpected = layerNameMap(expected.layers);
  const layerNameByIdActual = layerNameMap(actual.layers);
  const diagonal = drawingDiagonal(expected);
  const effectiveTolerance = Math.max(tolerance.coordinateAbsolute, tolerance.coordinateRelative * diagonal);

  const { pairs, missing, extra, ambiguous } = pairEntities(
    expected.entities,
    actual.entities,
    layerNameByIdExpected,
    layerNameByIdActual,
    effectiveTolerance
  );

  const findings = [];
  for (const id of missing) {
    findings.push({
      axis: "entity",
      severity: "critical",
      code: "entity-missing",
      message: `期待した図形が実際の図面に存在しません: ${id}`,
      expectedId: id,
      actualId: null
    });
  }
  for (const id of extra) {
    findings.push({
      axis: "entity",
      severity: "major",
      code: "entity-extra",
      message: `期待していない図形が実際の図面に存在します: ${id}`,
      expectedId: null,
      actualId: id
    });
  }
  for (const item of ambiguous) {
    findings.push({
      axis: "entity",
      severity: "minor",
      code: "ambiguous-pairing",
      message: "同一座標に同型図形が複数あり一意に対応付けできません。",
      expectedId: item.expectedId,
      actualId: null
    });
  }

  const axes = {
    entity: finalizeAxis("entity", { checked: expected.entities.length, passed: pairs.length }),
    coordinate: finalizeAxis("coordinate", evaluateCoordinateAxis(pairs, effectiveTolerance, tolerance, findings)),
    layer: finalizeAxis(
      "layer",
      evaluateLayerAxis(expected.layers, actual.layers, pairs, layerNameByIdExpected, layerNameByIdActual, findings)
    ),
    block: finalizeAxis("block", evaluateBlockAxis(pairs, effectiveTolerance, tolerance, findings)),
    text: finalizeAxis("text", evaluateTextAxis(pairs, effectiveTolerance, findings)),
    dimension: finalizeAxis("dimension", evaluateDimensionAxis(pairs, effectiveTolerance, findings)),
    layout: finalizeAxis("layout", evaluateLayoutAxis(expected, actual, tolerance, findings)),
    linetype: finalizeAxis("linetype", evaluateLinetypeAxis(pairs, tolerance, findings)),
    print: finalizeAxis("print", evaluatePrintAxis(expected, actual, pairs, findings))
  };

  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    mode: options.mode ?? "generic",
    tolerance,
    totals: {
      expectedEntities: expected.entities.length,
      actualEntities: actual.entities.length,
      paired: pairs.length,
      missing: missing.length,
      extra: extra.length,
      ambiguous: ambiguous.length
    },
    axes,
    findings
  };
}

export function pairEntities(expectedEntities, actualEntities, layerNameByIdExpected, layerNameByIdActual, effectiveTolerance) {
  const actualById = new Map(actualEntities.map((entity) => [entity.id, entity]));
  const claimed = new Set();
  const pairs = [];
  const remainingExpected = [];

  // Step 1: ID完全一致(JSON往復ではこの段階でほぼ全件決まる)
  for (const expectedEntity of expectedEntities) {
    const actualEntity = actualById.get(expectedEntity.id);
    if (actualEntity && actualEntity.type === expectedEntity.type && !claimed.has(actualEntity.id)) {
      pairs.push({ expected: expectedEntity, actual: actualEntity });
      claimed.add(actualEntity.id);
    } else {
      remainingExpected.push(expectedEntity);
    }
  }

  const remainingActual = actualEntities.filter((entity) => !claimed.has(entity.id));
  const actualIndex = buildSpatialIndex(remainingActual);
  const searchRadius = matchSearchRadius(effectiveTolerance);

  // Step 2: 型+レイヤー名+最近傍による貪欲マッチ。順序を安定させるため事前に決定論的ソートを行う。
  const sorted = [...remainingExpected].sort((a, b) => compareForOrder(a, b, layerNameByIdExpected));
  const missing = [];
  const ambiguous = [];

  for (const expectedEntity of sorted) {
    const expectedLayerName = layerNameByIdExpected.get(expectedEntity.layerId) ?? expectedEntity.layerId;
    const candidates = findCandidates(actualIndex, expectedEntity, expectedLayerName, layerNameByIdActual, searchRadius, claimed);

    if (candidates.length === 0) {
      missing.push(expectedEntity.id);
      continue;
    }

    const ranked = candidates
      .map((candidate) => ({ candidate, distance: entityDistance(expectedEntity, candidate) }))
      .sort((a, b) => a.distance - b.distance);
    const best = ranked[0];
    const tied = ranked.filter((item) => Math.abs(item.distance - best.distance) < EPSILON);

    if (tied.length > 1) {
      ambiguous.push({ expectedId: expectedEntity.id, candidateIds: tied.map((item) => item.candidate.id) });
      missing.push(expectedEntity.id);
      continue;
    }

    pairs.push({ expected: expectedEntity, actual: best.candidate });
    claimed.add(best.candidate.id);
  }

  const pairedActualIds = new Set(pairs.map((pair) => pair.actual.id));
  const extra = actualEntities.filter((entity) => !pairedActualIds.has(entity.id)).map((entity) => entity.id);

  return { pairs, missing, extra, ambiguous };
}

// 診断・ログ用のユーティリティ。実際のペアリングは空間インデックス経由の近傍探索で行うため
// 直接は使わないが、比較レポートを人間が読む際の識別子として有用。
export function entitySignature(entity, layerNameById, tolerance) {
  const layerName = layerNameById.get(entity.layerId) ?? entity.layerId;
  const center = boundsCenter(entityBounds(entity)) ?? { x: 0, y: 0 };
  const quantum = Math.max((tolerance?.coordinateAbsolute ?? 0.01) * 10, 1);
  const qx = Math.round(center.x / quantum) * quantum;
  const qy = Math.round(center.y / quantum) * quantum;
  return `${entity.type}|${layerName}|${qx}:${qy}`;
}

function findCandidates(actualIndex, expectedEntity, expectedLayerName, layerNameByIdActual, radius, claimed) {
  const center = boundsCenter(entityBounds(expectedEntity));
  const viewport = center
    ? { minX: center.x - radius, minY: center.y - radius, maxX: center.x + radius, maxY: center.y + radius }
    : null;
  let candidates = queryBounds(actualIndex, viewport).filter((candidate) =>
    matchesTypeAndLayer(candidate, expectedEntity, expectedLayerName, layerNameByIdActual, claimed)
  );
  if (candidates.length === 0 && viewport) {
    // 局所探索で見つからない場合は全件探索へフォールバック(大きく移動した図形でも必ず対応付ける)
    candidates = queryBounds(actualIndex, null).filter((candidate) =>
      matchesTypeAndLayer(candidate, expectedEntity, expectedLayerName, layerNameByIdActual, claimed)
    );
  }
  return candidates;
}

function matchesTypeAndLayer(candidate, expectedEntity, expectedLayerName, layerNameByIdActual, claimed) {
  if (claimed.has(candidate.id)) return false;
  if (candidate.type !== expectedEntity.type) return false;
  const candidateLayerName = layerNameByIdActual.get(candidate.layerId) ?? candidate.layerId;
  return candidateLayerName === expectedLayerName;
}

function entityDistance(expectedEntity, actualEntity) {
  const expectedFacets = geometryFacets(expectedEntity);
  const actualFacets = geometryFacets(actualEntity);
  if (expectedFacets.points.length !== actualFacets.points.length) return Number.POSITIVE_INFINITY;
  let sum = 0;
  for (let i = 0; i < expectedFacets.points.length; i += 1) {
    sum += distance(expectedFacets.points[i], actualFacets.points[i]);
  }
  return sum;
}

function compareForOrder(a, b, layerNameById) {
  const typeCompare = a.type.localeCompare(b.type);
  if (typeCompare !== 0) return typeCompare;
  const layerA = layerNameById.get(a.layerId) ?? a.layerId;
  const layerB = layerNameById.get(b.layerId) ?? b.layerId;
  const layerCompare = layerA.localeCompare(layerB);
  if (layerCompare !== 0) return layerCompare;
  const centerA = boundsCenter(entityBounds(a)) ?? { x: 0, y: 0 };
  const centerB = boundsCenter(entityBounds(b)) ?? { x: 0, y: 0 };
  if (centerA.x !== centerB.x) return centerA.x - centerB.x;
  if (centerA.y !== centerB.y) return centerA.y - centerB.y;
  return a.id.localeCompare(b.id);
}

function matchSearchRadius(effectiveTolerance) {
  return Math.max(50, effectiveTolerance * 1000);
}

// 型ごとに「位置を表す点群」と「スカラー量」を分離して返す。点群は座標軸の比較・
// ペアリングの近傍探索双方に使う。スカラーは半径・幅高さ・回転角等、点では表せない量。
function geometryFacets(entity) {
  switch (entity.type) {
    case "line":
    case "polyline":
    case "hatch":
      return { points: entity.points, scalars: {} };
    case "dimension":
      return { points: entity.points, scalars: { offset: entity.offset } };
    case "rect":
      return { points: [entity.origin], scalars: { width: entity.width, height: entity.height } };
    case "circle":
      return { points: [entity.center], scalars: { radius: entity.radius } };
    case "text":
      return { points: [entity.at], scalars: { size: entity.size } };
    case "block":
      return { points: [entity.insertion], scalars: { rotation: entity.rotation, scale: entity.scale } };
    default:
      return { points: [], scalars: {} };
  }
}

function evaluateCoordinateAxis(pairs, effectiveTolerance, tolerance, findings) {
  let checked = 0;
  let passed = 0;
  for (const { expected, actual } of pairs) {
    const expectedFacets = geometryFacets(expected);
    const actualFacets = geometryFacets(actual);
    for (let i = 0; i < expectedFacets.points.length; i += 1) {
      checked += 1;
      const actualPoint = actualFacets.points[i];
      const d = actualPoint ? distance(expectedFacets.points[i], actualPoint) : Number.POSITIVE_INFINITY;
      if (d <= effectiveTolerance) {
        passed += 1;
      } else {
        findings.push({
          axis: "coordinate",
          severity: d > effectiveTolerance * 10 ? "major" : "minor",
          code: "coordinate-deviation",
          message: `座標が許容差を超えて異なります(差 ${round4(d)})`,
          expectedId: expected.id,
          actualId: actual.id,
          delta: round4(d)
        });
      }
    }
    const scalarKeys = new Set([...Object.keys(expectedFacets.scalars), ...Object.keys(actualFacets.scalars)]);
    for (const key of scalarKeys) {
      checked += 1;
      const expectedValue = expectedFacets.scalars[key] ?? 0;
      const actualValue = actualFacets.scalars[key] ?? 0;
      const d = Math.abs(expectedValue - actualValue);
      const scalarTolerance = key === "rotation" ? tolerance.angle : effectiveTolerance;
      if (d <= scalarTolerance) {
        passed += 1;
      } else {
        findings.push({
          axis: "coordinate",
          severity: "major",
          code: `${key}-deviation`,
          message: `${key}が許容差を超えて異なります(差 ${round4(d)})`,
          expectedId: expected.id,
          actualId: actual.id,
          delta: round4(d)
        });
      }
    }
  }
  return { checked, passed };
}

function evaluateLayerAxis(expectedLayers, actualLayers, pairs, layerNameByIdExpected, layerNameByIdActual, findings) {
  let checked = 0;
  let passed = 0;
  const actualByName = new Map(actualLayers.map((layer) => [layer.name, layer]));
  const attrs = ["color", "visible", "locked", "printable"];
  for (const expectedLayer of expectedLayers) {
    const actualLayer = actualByName.get(expectedLayer.name);
    for (const attr of attrs) {
      checked += 1;
      if (actualLayer && actualLayer[attr] === expectedLayer[attr]) {
        passed += 1;
      } else {
        findings.push({
          axis: "layer",
          severity: attr === "locked" ? "major" : "minor",
          code: `layer-${attr}-mismatch`,
          message: `レイヤー「${expectedLayer.name}」の${attr}が異なります。`,
          expectedId: expectedLayer.id,
          actualId: actualLayer?.id ?? null
        });
      }
    }
  }
  for (const { expected, actual } of pairs) {
    checked += 1;
    const expectedLayerName = layerNameByIdExpected.get(expected.layerId) ?? expected.layerId;
    const actualLayerName = layerNameByIdActual.get(actual.layerId) ?? actual.layerId;
    if (expectedLayerName === actualLayerName) {
      passed += 1;
    } else {
      findings.push({
        axis: "layer",
        severity: "major",
        code: "entity-layer-reassigned",
        message: `図形のレイヤー帰属が変化しました(期待: ${expectedLayerName}, 実際: ${actualLayerName})`,
        expectedId: expected.id,
        actualId: actual.id
      });
    }
  }
  return { checked, passed };
}

function evaluateBlockAxis(pairs, effectiveTolerance, tolerance, findings) {
  let checked = 0;
  let passed = 0;
  for (const { expected, actual } of pairs) {
    if (expected.type !== "block") continue;
    checked += 5;
    if (expected.name === actual.name) passed += 1;
    else findings.push(entityFinding("block", expected, actual, "name"));
    if (distance(expected.insertion, actual.insertion) <= effectiveTolerance) passed += 1;
    else findings.push(entityFinding("block", expected, actual, "insertion"));
    if (Math.abs(expected.rotation - actual.rotation) <= tolerance.angle) passed += 1;
    else findings.push(entityFinding("block", expected, actual, "rotation"));
    if (Math.abs(expected.scale - actual.scale) <= effectiveTolerance) passed += 1;
    else findings.push(entityFinding("block", expected, actual, "scale"));
    if (expected.children.length === actual.children.length && attributesEqual(expected.attributes, actual.attributes)) passed += 1;
    else findings.push(entityFinding("block", expected, actual, "children-or-attributes"));
  }
  return { checked, passed };
}

function attributesEqual(a, b) {
  const aKeys = Object.keys(a ?? {}).sort();
  const bKeys = Object.keys(b ?? {}).sort();
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every((key, index) => key === bKeys[index] && a[key] === b[key]);
}

function evaluateTextAxis(pairs, effectiveTolerance, findings) {
  let checked = 0;
  let passed = 0;
  for (const { expected, actual } of pairs) {
    if (expected.type !== "text") continue;
    checked += 3;
    if (normalizeText(expected.value) === normalizeText(actual.value)) passed += 1;
    else findings.push(entityFinding("text", expected, actual, "content"));
    if (distance(expected.at, actual.at) <= effectiveTolerance) passed += 1;
    else findings.push(entityFinding("text", expected, actual, "position"));
    if (Math.abs(expected.size - actual.size) <= effectiveTolerance) passed += 1;
    else findings.push(entityFinding("text", expected, actual, "size"));
  }
  return { checked, passed };
}

function normalizeText(value) {
  return String(value ?? "")
    .normalize("NFC")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+$/gm, "")
    .trim();
}

function evaluateDimensionAxis(pairs, effectiveTolerance, findings) {
  let checked = 0;
  let passed = 0;
  for (const { expected, actual } of pairs) {
    if (expected.type !== "dimension") continue;
    checked += 5;
    if (distance(expected.points[0], actual.points[0]) <= effectiveTolerance) passed += 1;
    else findings.push(entityFinding("dimension", expected, actual, "start-point"));
    if (distance(expected.points[1], actual.points[1]) <= effectiveTolerance) passed += 1;
    else findings.push(entityFinding("dimension", expected, actual, "end-point"));
    if (Math.abs(expected.offset - actual.offset) <= effectiveTolerance) passed += 1;
    else findings.push(entityFinding("dimension", expected, actual, "offset"));
    if (expected.precision === actual.precision) passed += 1;
    else findings.push(entityFinding("dimension", expected, actual, "precision"));
    if (expected.suffix === actual.suffix) passed += 1;
    else findings.push(entityFinding("dimension", expected, actual, "suffix"));
  }
  return { checked, passed };
}

function evaluateLayoutAxis(expected, actual, tolerance, findings) {
  const fields = ["paper", "orientation", "scale", "margin", "title"];
  let checked = fields.length + 1;
  let passed = 0;
  for (const field of fields) {
    const expectedValue = expected.layout?.[field];
    const actualValue = actual.layout?.[field];
    const ok = typeof expectedValue === "number" ? Math.abs(expectedValue - actualValue) <= tolerance.margin : expectedValue === actualValue;
    if (ok) {
      passed += 1;
    } else {
      findings.push({
        axis: "layout",
        severity: field === "paper" || field === "scale" ? "critical" : "major",
        code: `layout-${field}-mismatch`,
        message: `レイアウトの${field}が異なります。`,
        expectedId: expected.id,
        actualId: actual.id
      });
    }
  }
  if (expected.unit === actual.unit) {
    passed += 1;
  } else {
    findings.push({
      axis: "layout",
      severity: "critical",
      code: "unit-mismatch",
      message: "単位が異なります。",
      expectedId: expected.id,
      actualId: actual.id
    });
  }
  return { checked, passed };
}

function evaluateLinetypeAxis(pairs, tolerance, findings) {
  let checked = 0;
  let passed = 0;
  for (const { expected, actual } of pairs) {
    checked += 3;
    if (Math.abs((expected.style?.strokeWidth ?? 0) - (actual.style?.strokeWidth ?? 0)) <= tolerance.strokeWidth) {
      passed += 1;
    } else {
      findings.push(entityFinding("linetype", expected, actual, "strokeWidth"));
    }
    const expectedDash = expected.style?.lineDash ?? [];
    const actualDash = actual.style?.lineDash ?? [];
    if (lineDashEqual(expectedDash, actualDash, tolerance.lineDash)) {
      passed += 1;
    } else {
      findings.push({
        ...entityFinding("linetype", expected, actual, "lineDash"),
        severity: (expectedDash.length > 0) !== (actualDash.length > 0) ? "major" : "minor"
      });
    }
    if ((expected.style?.fill ?? "transparent") === (actual.style?.fill ?? "transparent")) {
      passed += 1;
    } else {
      findings.push(entityFinding("linetype", expected, actual, "fill"));
    }
  }
  return { checked, passed };
}

function lineDashEqual(a, b, tolerance) {
  if (a.length !== b.length) return false;
  return a.every((value, index) => Math.abs(value - b[index]) <= tolerance);
}

function evaluatePrintAxis(expected, actual, pairs, findings) {
  const expectedLayerByName = new Map(expected.layers.map((layer) => [layer.name, layer]));
  const actualLayerByName = new Map(actual.layers.map((layer) => [layer.name, layer]));
  let checked = 0;
  let passed = 0;
  for (const [name, expectedLayer] of expectedLayerByName) {
    checked += 1;
    const actualLayer = actualLayerByName.get(name);
    if (actualLayer && actualLayer.printable === expectedLayer.printable) {
      passed += 1;
    } else {
      findings.push({
        axis: "print",
        severity: "major",
        code: "printable-flag-mismatch",
        message: `レイヤー「${name}」の印刷可否設定が異なります。`,
        expectedId: expectedLayer.id,
        actualId: actualLayer?.id ?? null
      });
    }
  }
  const expectedLayerById = new Map(expected.layers.map((layer) => [layer.id, layer]));
  const actualLayerById = new Map(actual.layers.map((layer) => [layer.id, layer]));
  for (const { expected: expectedEntity, actual: actualEntity } of pairs) {
    checked += 1;
    const expectedPrintable = expectedLayerById.get(expectedEntity.layerId)?.printable ?? true;
    const actualPrintable = actualLayerById.get(actualEntity.layerId)?.printable ?? true;
    if (expectedPrintable === actualPrintable) {
      passed += 1;
    } else {
      findings.push({
        axis: "print",
        severity: "minor",
        code: "entity-printability-changed",
        message: "図形の印刷対象状態が変化しました。",
        expectedId: expectedEntity.id,
        actualId: actualEntity.id
      });
    }
  }
  return { checked, passed };
}

function entityFinding(axis, expected, actual, field) {
  return {
    axis,
    severity: "minor",
    code: `${axis}-${field}-mismatch`,
    message: `${axis}の${field}が異なります。`,
    expectedId: expected.id,
    actualId: actual.id
  };
}

function finalizeAxis(axisName, { checked, passed }) {
  return { axis: axisName, checked, passed, score: checked === 0 ? 1 : round4(passed / checked) };
}

function layerNameMap(layers) {
  return new Map(layers.map((layer) => [layer.id, layer.name]));
}

function boundsCenter(bounds) {
  if (!bounds) return null;
  return { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 };
}

function drawingDiagonal(drawing) {
  const bounds = drawing.entities.map(entityBounds).filter(Boolean);
  if (bounds.length === 0) return EMPTY_DRAWING_DIAGONAL_FALLBACK;
  const minX = Math.min(...bounds.map((b) => b.minX));
  const minY = Math.min(...bounds.map((b) => b.minY));
  const maxX = Math.max(...bounds.map((b) => b.maxX));
  const maxY = Math.max(...bounds.map((b) => b.maxY));
  return Math.sqrt((maxX - minX) ** 2 + (maxY - minY) ** 2);
}

function distance(a, b) {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}

function round4(value) {
  return Math.round(value * 10000) / 10000;
}
