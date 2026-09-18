const TYPES = new Set(["aligned", "horizontal", "vertical", "rotated", "angular", "ordinate", "radius", "diameter"]);
const finitePoint = (p) => p && Number.isFinite(p.x) && Number.isFinite(p.y);

export function dimensionOptions(options = {}) {
  const result = {
    dimensionType: options.dimensionType ?? "aligned",
    offset: Number(options.offset ?? 350),
    precision: Number(options.precision ?? 0),
    prefix: String(options.prefix ?? ""), suffix: String(options.suffix ?? ""),
    textSize: Number(options.textSize ?? 180), arrowSize: Number(options.arrowSize ?? 120),
    measurementScale: Number(options.measurementScale ?? 1),
    references: options.references == null ? null : structuredClone(options.references)
  };
  if (!TYPES.has(result.dimensionType) || !Number.isFinite(result.offset) ||
    !Number.isInteger(result.precision) || result.precision < 0 || result.precision > 6 ||
    ![result.textSize, result.arrowSize, result.measurementScale].every((value) => Number.isFinite(value) && value > 0)) {
    throw new Error("Invalid dimension type, precision, scale or size");
  }
  if (result.references !== null && (!Array.isArray(result.references) || result.references.length !== 2 || result.references.some((ref) => !ref || typeof ref.entityId !== "string" || !["point", "center", "radius"].includes(ref.kind) || (ref.kind === "point" && (!Number.isInteger(ref.index) || ref.index < 0)) || (ref.kind === "radius" && !Number.isFinite(ref.angle))))) {
    throw new Error("Invalid dimension references");
  }
  return result;
}

function referencePoint(reference, entities) {
  const entity = entities.get(reference.entityId);
  if (!entity || entity.type === "dimension") return null;
  if (reference.kind === "point") return entity.points?.[reference.index] ?? null;
  if (reference.kind === "center") return entity.center ?? null;
  if (reference.kind === "radius" && ["circle", "arc"].includes(entity.type) && entity.radius > 0) {
    const radians = reference.angle * Math.PI / 180;
    return { x: entity.center.x + entity.radius * Math.cos(radians), y: entity.center.y + entity.radius * Math.sin(radians) };
  }
  return null;
}

export function dimensionReferencePoints(dimension, entities) {
  dimensionOptions(dimension);
  return dimension.references?.map((reference) => referencePoint(reference, entities)) ?? null;
}

// Resolve after all commands so a group edit is independent of command order.
export function resolveDimensions(drawing) {
  const entities = new Map(drawing.entities.map((entity) => [entity.id, entity]));
  for (const dimension of drawing.entities) {
    if (dimension.type !== "dimension") continue;
    dimensionOptions(dimension);
    if (!dimension.references) { delete dimension.associationStatus; continue; }
    const points = dimensionReferencePoints(dimension, entities);
    dimension.associationStatus = points.every(finitePoint) ? "associated" : "broken";
    if (dimension.associationStatus === "associated") dimension.points = structuredClone(points);
  }
}

export function dimensionGeometry(entity) {
  const options = dimensionOptions(entity);
  if (!Array.isArray(entity.points) || entity.points.length !== 2 || !entity.points.every(finitePoint)) throw new Error("Invalid dimension points");
  const [a, b] = entity.points;
  const dx = b.x - a.x, dy = b.y - a.y;
  const length = Math.hypot(dx, dy);
  const unit = length > 1e-9 ? { x: dx / length, y: dy / length } : { x: 1, y: 0 };
  let start, end, value;
  if (options.dimensionType === "angular") {
    const definitions = entity.definitionPoints ?? {};
    const firstStart = definitions["13"] ?? a, firstEnd = definitions["14"] ?? b;
    const secondStart = definitions["15"] ?? a, secondEnd = definitions["16"] ?? b;
    const center = lineIntersection(firstStart, firstEnd, secondStart, secondEnd) ?? a;
    const anchor = entity.dimensionLinePoint ?? entity.textPoint ?? b;
    const firstAngle = Math.atan2(firstEnd.y - center.y, firstEnd.x - center.x);
    const secondAngleRaw = Math.atan2(secondEnd.y - center.y, secondEnd.x - center.x);
    const twoPi = Math.PI * 2;
    // firstAngleからCCW方向にsecondAngleへ達するまでの掃引角(0〜2πの範囲)。
    const ccwSweep = ((secondAngleRaw - firstAngle) % twoPi + twoPi) % twoPi;
    // dimensionLinePoint(なければtextPoint、それも無ければ計測線の終点)がCCW側の弧
    // (0〜ccwSweep)に含まれるかどうかで、実際に表示すべき弧(鋭角側/劣角側)を選ぶ。
    // 含まれない場合は補角側(CW方向、負の掃引)を採用する。
    const anchorOffset = ((Math.atan2(anchor.y - center.y, anchor.x - center.x) - firstAngle) % twoPi + twoPi) % twoPi;
    const sweep = anchorOffset <= ccwSweep ? ccwSweep : ccwSweep - twoPi;
    const radius = Math.max(1e-9, Math.hypot(anchor.x - center.x, anchor.y - center.y));
    const arcPoints = Array.from({ length: 17 }, (_unused, index) => {
      const current = firstAngle + sweep * index / 16;
      return { x: center.x + radius * Math.cos(current), y: center.y + radius * Math.sin(current) };
    });
    const value = Math.abs(sweep) * 180 / Math.PI;
    const numeric = (value * options.measurementScale).toFixed(options.precision);
    const label = entity.associationStatus === "broken" ? "[?]" : entity.textOverride && entity.textOverride !== "<>" ? entity.textOverride.replace("<>", numeric) : `${options.prefix}${numeric}${options.suffix}`;
    return { segments: [[center, arcPoints[0]], ...arcPoints.slice(1).map((point, index) => [arcPoints[index], point]), [center, arcPoints.at(-1)]], start: arcPoints[0], end: arcPoints.at(-1),
      textPoint: entity.textPoint ?? arcPoints[Math.floor(arcPoints.length / 2)], label, value, ...options };
  }
  if (options.dimensionType === "horizontal") {
    start = { x: a.x, y: a.y + options.offset }; end = { x: b.x, y: start.y }; value = Math.abs(dx);
  } else if (options.dimensionType === "vertical") {
    start = { x: a.x + options.offset, y: a.y }; end = { x: start.x, y: b.y }; value = Math.abs(dy);
  } else if (["radius", "diameter"].includes(options.dimensionType)) {
    start = options.dimensionType === "diameter" ? { x: a.x - dx, y: a.y - dy } : a;
    end = b; value = length * (options.dimensionType === "diameter" ? 2 : 1);
  } else if (options.dimensionType === "rotated") {
    const radians = Number(entity.dimensionLineAngle ?? 0) * Math.PI / 180;
    const axis = { x: Math.cos(radians), y: Math.sin(radians) }, normal = { x: -axis.y, y: axis.x };
    const projection = (point) => point.x * axis.x + point.y * axis.y;
    const anchor = entity.dimensionLinePoint ?? { x: a.x + normal.x * options.offset, y: a.y + normal.y * options.offset };
    start = { x: anchor.x + axis.x * (projection(a) - projection(anchor)), y: anchor.y + axis.y * (projection(a) - projection(anchor)) };
    end = { x: anchor.x + axis.x * (projection(b) - projection(anchor)), y: anchor.y + axis.y * (projection(b) - projection(anchor)) };
    value = Math.abs(projection(b) - projection(a));
  } else if (options.dimensionType === "ordinate") {
    // DXF: 13=feature location(=a)、14=leader endpoint(=b)、10=作成時のUCS原点
    // (entity.dimensionLinePointとして保持)。70のbit 64(0x40)がX軸かY軸かを示す
    // (未設定時はa/bの変位が大きい軸を推定、DXF由来でない場合の防御)。測定値は
    // 選択軸についてfeature locationと原点の差の絶対値(leader endpointの絶対座標
    // ではない)。
    const origin = entity.dimensionLinePoint ?? { x: 0, y: 0 };
    const xAxis = Number.isInteger(entity.dxfDimensionType) ? Boolean(entity.dxfDimensionType & 64) : Math.abs(b.x - a.x) >= Math.abs(b.y - a.y);
    start = a; end = b;
    value = xAxis ? Math.abs(a.x - origin.x) : Math.abs(a.y - origin.y);
  } else {
    start = { x: a.x - unit.y * options.offset, y: a.y + unit.x * options.offset };
    end = { x: b.x - unit.y * options.offset, y: b.y + unit.x * options.offset }; value = length;
  }
  const radial = ["radius", "diameter"].includes(options.dimensionType);
  const segments = radial ? [[start, end]] : [[a, start], [start, end], [b, end]];
  const textPoint = entity.textPoint ?? { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 - options.textSize * 0.25 };
  const numeric = (value * options.measurementScale).toFixed(options.precision);
  const symbol = options.dimensionType === "radius" ? "R" : options.dimensionType === "diameter" ? "DIA " : "";
  const generated = `${options.prefix}${symbol}${numeric}${options.suffix}`;
  const label = entity.associationStatus === "broken" ? "[?]" : entity.textOverride && entity.textOverride !== "<>" ? entity.textOverride.replace("<>", generated) : generated;
  return { segments, start, end, textPoint, label, value: value * options.measurementScale, ...options };
}

function lineIntersection(a, b, c, d) {
  const ab = { x: b.x - a.x, y: b.y - a.y }, cd = { x: d.x - c.x, y: d.y - c.y };
  const denominator = ab.x * cd.y - ab.y * cd.x;
  if (Math.abs(denominator) < 1e-9) return null;
  const t = ((c.x - a.x) * cd.y - (c.y - a.y) * cd.x) / denominator;
  return { x: a.x + ab.x * t, y: a.y + ab.y * t };
}
