const TYPES = new Set(["aligned", "horizontal", "vertical", "radius", "diameter"]);
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
  if (options.dimensionType === "horizontal") {
    start = { x: a.x, y: a.y + options.offset }; end = { x: b.x, y: start.y }; value = Math.abs(dx);
  } else if (options.dimensionType === "vertical") {
    start = { x: a.x + options.offset, y: a.y }; end = { x: start.x, y: b.y }; value = Math.abs(dy);
  } else if (["radius", "diameter"].includes(options.dimensionType)) {
    start = options.dimensionType === "diameter" ? { x: a.x - dx, y: a.y - dy } : a;
    end = b; value = length * (options.dimensionType === "diameter" ? 2 : 1);
  } else {
    start = { x: a.x - unit.y * options.offset, y: a.y + unit.x * options.offset };
    end = { x: b.x - unit.y * options.offset, y: b.y + unit.x * options.offset }; value = length;
  }
  const radial = ["radius", "diameter"].includes(options.dimensionType);
  const segments = radial ? [[start, end]] : [[a, start], [start, end], [b, end]];
  const textPoint = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 - options.textSize * 0.25 };
  const numeric = (value * options.measurementScale).toFixed(options.precision);
  const symbol = options.dimensionType === "radius" ? "R" : options.dimensionType === "diameter" ? "DIA " : "";
  const label = entity.associationStatus === "broken" ? "[?]" : `${options.prefix}${symbol}${numeric}${options.suffix}`;
  return { segments, start, end, textPoint, label, value: value * options.measurementScale, ...options };
}
