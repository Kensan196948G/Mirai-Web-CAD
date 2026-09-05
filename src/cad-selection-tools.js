import { arcPointAt, arcSweepDegrees, entityBounds, sampleEllipse, sampleSpline } from "./cad-core.js";
import { collectBoundarySegments, transformEntity } from "./cad-advanced.js";
import { dimensionGeometry } from "./cad-dimension.js";
import { selectableEntities } from "./cad-selection.js";

function segments(entity) {
  if (entity.type === "block") return (entity.children ?? []).flatMap((child) => segments(transformEntity(child, { dx: entity.insertion.x, dy: entity.insertion.y, angle: entity.rotation ?? 0, scale: entity.scale ?? 1 })));
  if (entity.type === "dimension") return dimensionGeometry(entity).segments;
  let points;
  if (entity.type === "circle" || entity.type === "arc") {
    const start = entity.type === "circle" ? 0 : entity.startAngle;
    const sweep = entity.type === "circle" ? 360 : arcSweepDegrees(entity);
    points = Array.from({ length: 257 }, (_, i) => arcPointAt(entity, start + sweep * i / 256));
  }
  if (entity.type === "ellipse") points = sampleEllipse(entity);
  if (entity.type === "spline") {
    points = sampleSpline(entity);
    if (entity.closed) points.push(points[0]);
  }
  if (entity.type === "text") {
    const b = entityBounds(entity);
    return segments({ type: "rect", origin: { x: b.minX, y: b.minY }, width: b.maxX - b.minX, height: b.maxY - b.minY });
  }
  return points ? points.slice(1).map((p, i) => [points[i], p]) : collectBoundarySegments([entity]).map(({ a, b }) => [a, b]);
}

function onSegment(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const length = Math.hypot(dx, dy);
  if (length < 1e-9) return Math.hypot(p.x - a.x, p.y - a.y) < 1e-9;
  const cross = dx * (p.y - a.y) - dy * (p.x - a.x);
  const dot = (p.x - a.x) * dx + (p.y - a.y) * dy;
  return Math.abs(cross) <= 1e-9 * length && dot >= -1e-9 && dot <= length * length + 1e-9;
}

function intersects(a, b, c, d) {
  if (onSegment(a, c, d) || onSegment(b, c, d) || onSegment(c, a, b) || onSegment(d, a, b)) return true;
  const cross = (p, q, r) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  return cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0;
}

function contains(point, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[j], b = polygon[i];
    if (onSegment(point, a, b)) return true;
    if ((a.y > point.y) !== (b.y > point.y) && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

export function selectByPath(drawing, points, mode = "fence") {
  if (!["fence", "lasso"].includes(mode) || points.length < (mode === "lasso" ? 3 : 2) || points.length > 2000 || points.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y))) throw new Error("Invalid selection path");
  const path = mode === "lasso" ? [...points, points[0]] : points;
  return selectableEntities(drawing).filter((entity) => {
    const edges = segments(entity);
    if (edges.some(([a, b]) => path.slice(1).some((p, i) => intersects(a, b, path[i], p)))) return true;
    if (["hatch", "text"].includes(entity.type) && edges.length && contains(points[0], edges.map(([p]) => p))) return true;
    return mode === "lasso" && edges.some(([p]) => contains(p, points));
  }).map((entity) => entity.id);
}

export function quickSelect(drawing, filters) {
  const allowed = new Set(["type", "layer", "color", "width"]);
  if (!Object.keys(filters).length || Object.keys(filters).some((key) => !allowed.has(key))) throw new Error("QSELECT: type/layer/color/width");
  if (filters.width !== undefined && (!Number.isFinite(Number(filters.width)) || Number(filters.width) <= 0)) throw new Error("Invalid line width");
  const layers = new Map(drawing.layers.map((layer) => [layer.id, layer]));
  return selectableEntities(drawing).filter((entity) => {
    const layer = layers.get(entity.layerId);
    return Object.entries(filters).every(([key, value]) => {
      if (key === "type") return entity.type.toLowerCase() === String(value).toLowerCase();
      if (key === "layer") return entity.layerId === value || layer.name === value;
      if (key === "color") return layer.color.toLowerCase() === String(value).toLowerCase();
      if (!Number.isFinite(Number(value))) throw new Error("Invalid line width");
      return (entity.style?.strokeWidth ?? 2) === Number(value);
    });
  }).map((entity) => entity.id);
}
