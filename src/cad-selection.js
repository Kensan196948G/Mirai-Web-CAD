import { angleOnArc, boundsIntersect, entityBounds, sampleEllipse, sampleSpline } from "./cad-core.js";
import { transformEntity } from "./cad-advanced.js";
import { blockWorldEntities } from "./cad-affine.js";
import { dimensionGeometry } from "./cad-dimension.js";

export function selectionBounds(a, b) {
  return { minX: Math.min(a.x, b.x), minY: Math.min(a.y, b.y), maxX: Math.max(a.x, b.x), maxY: Math.max(a.y, b.y) };
}

function inside(p, box) {
  return p.x >= box.minX && p.x <= box.maxX && p.y >= box.minY && p.y <= box.maxY;
}

function corners(box) {
  return [{ x: box.minX, y: box.minY }, { x: box.maxX, y: box.minY }, { x: box.maxX, y: box.maxY }, { x: box.minX, y: box.maxY }];
}

function segmentCrosses(a, b, box) {
  let low = 0;
  let high = 1;
  for (const [start, delta, min, max] of [[a.x, b.x - a.x, box.minX, box.maxX], [a.y, b.y - a.y, box.minY, box.maxY]]) {
    if (delta === 0) {
      if (start < min || start > max) return false;
    } else {
      const first = (min - start) / delta;
      const last = (max - start) / delta;
      low = Math.max(low, Math.min(first, last));
      high = Math.min(high, Math.max(first, last));
      if (low > high) return false;
    }
  }
  return true;
}

function crosses(entity, box) {
  const bounds = entityBounds(entity);
  if (!bounds || !boundsIntersect(bounds, box)) return false;
  if (entity.type === "block") {
    if (entity.definitionId) return blockWorldEntities(entity).some((child) => crosses(child, box));
    return (entity.children ?? []).some((child) => crosses(transformEntity(child, {
      dx: entity.insertion.x, dy: entity.insertion.y, angle: entity.rotation ?? 0, scale: entity.scale ?? 1
    }), box));
  }
  if (entity.type === "circle" || entity.type === "arc") {
    const candidates = [];
    for (const x of [box.minX, box.maxX]) {
      const square = entity.radius ** 2 - (x - entity.center.x) ** 2;
      if (square >= 0) for (const sign of [-1, 1]) candidates.push({ x, y: entity.center.y + sign * Math.sqrt(square) });
    }
    for (const y of [box.minY, box.maxY]) {
      const square = entity.radius ** 2 - (y - entity.center.y) ** 2;
      if (square >= 0) for (const sign of [-1, 1]) candidates.push({ x: entity.center.x + sign * Math.sqrt(square), y });
    }
    if (inside({ x: bounds.minX, y: bounds.minY }, box) && inside({ x: bounds.maxX, y: bounds.maxY }, box)) return true;
    return candidates.some((p) => inside(p, box) && (entity.type === "circle" || angleOnArc(Math.atan2(p.y - entity.center.y, p.x - entity.center.x) * 180 / Math.PI, entity.startAngle, entity.endAngle)));
  }
  let points = entity.points;
  let closed = entity.closed || entity.type === "hatch";
  if (entity.type === "rect" || entity.type === "text") { points = corners(bounds); closed = true; }
  if (entity.type === "ellipse") points = sampleEllipse(entity);
  if (entity.type === "spline") points = sampleSpline(entity);
  if (entity.type === "dimension") {
    return dimensionGeometry(entity).segments.some(([a, b]) => segmentCrosses(a, b, box));
  }
  if (!points?.length) return false;
  const path = closed ? [...points, points[0]] : points;
  if (path.some((p) => inside(p, box)) || path.slice(1).some((p, i) => segmentCrosses(path[i], p, box))) return true;
  if (entity.type === "text" || entity.type === "hatch") {
    const p = corners(box)[0];
    let contained = false;
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
      const a = points[i], b = points[j];
      if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) contained = !contained;
    }
    return contained;
  }
  return false;
}

export function selectableEntities(drawing) {
  const layers = new Set(drawing.layers.filter((layer) => layer.visible && !layer.frozen).map((layer) => layer.id));
  return drawing.entities.filter((entity) => layers.has(entity.layerId));
}

export function selectInBox(drawing, a, b, crossing = b.x < a.x) {
  const box = selectionBounds(a, b);
  return selectableEntities(drawing).filter((entity) => {
    const bounds = entityBounds(entity);
    if (!bounds) return false;
    return crossing ? crosses(entity, box) : inside({ x: bounds.minX, y: bounds.minY }, box) && inside({ x: bounds.maxX, y: bounds.maxY }, box);
  }).map((entity) => entity.id);
}

export function entityGrips(entity) {
  const grips = [];
  const add = (key, point, index = -1) => grips.push({ key, point, index });
  if (entity.points && ["line", "polyline", "hatch", "dimension"].includes(entity.type) && !entity.references) entity.points.forEach((p, i) => add("points", p, i));
  if (["line", "polyline"].includes(entity.type)) {
    const count = entity.closed ? entity.points.length : entity.points.length - 1;
    for (let i = 0; i < count; i++) {
      const a = entity.points[i], b = entity.points[(i + 1) % entity.points.length];
      add("midpoint", { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, i);
    }
  }
  if (entity.type === "dimension" && !["radius", "diameter"].includes(entity.dimensionType)) {
    const geometry = dimensionGeometry(entity);
    add("offset", { x: (geometry.start.x + geometry.end.x) / 2, y: (geometry.start.y + geometry.end.y) / 2 });
  }
  if (entity.type === "spline") entity.controlPoints.forEach((p, i) => add("controlPoints", p, i));
  if (entity.center) add("move", entity.center);
  if (entity.type === "circle") add("radius", { x: entity.center.x + entity.radius, y: entity.center.y });
  if (entity.type === "arc") for (const key of ["startAngle", "endAngle"]) {
    const angle = entity[key] * Math.PI / 180;
    add(key, { x: entity.center.x + entity.radius * Math.cos(angle), y: entity.center.y + entity.radius * Math.sin(angle) });
  }
  if (entity.type === "arc") {
    const sweep = ((entity.endAngle - entity.startAngle) % 360 + 360) % 360;
    const angle = (entity.startAngle + sweep / 2) * Math.PI / 180;
    add("radius", { x: entity.center.x + entity.radius * Math.cos(angle), y: entity.center.y + entity.radius * Math.sin(angle) });
  }
  if (entity.type === "ellipse") for (const key of ["radiusX", "radiusY"]) {
    const angle = (entity.rotation ?? 0) * Math.PI / 180 + (key === "radiusY" ? Math.PI / 2 : 0);
    add(key, { x: entity.center.x + entity[key] * Math.cos(angle), y: entity.center.y + entity[key] * Math.sin(angle) });
  }
  if (entity.type === "text") add("move", entity.at);
  if (entity.type === "block") add("move", entity.insertion);
  if (entity.type === "rect") {
    corners(entityBounds(entity)).forEach((point, index) => add("corner", point, index));
    add("move", { x: entity.origin.x + entity.width / 2, y: entity.origin.y + entity.height / 2 });
  }
  return grips;
}

export function moveGrip(entity, grip, target) {
  const next = structuredClone(entity);
  if (![target.x, target.y].every(Number.isFinite)) throw new Error("Invalid grip coordinate");
  if (grip.key === "move") return transformEntity(entity, { dx: target.x - grip.point.x, dy: target.y - grip.point.y });
  if (grip.key === "midpoint") {
    const dx = target.x - grip.point.x, dy = target.y - grip.point.y;
    const indices = [grip.index, (grip.index + 1) % entity.points.length];
    next.points = next.points.map((point, index) => indices.includes(index) ? { x: point.x + dx, y: point.y + dy } : point);
    return next;
  }
  if (grip.key === "corner") {
    const opposite = corners(entityBounds(entity))[(grip.index + 2) % 4];
    next.origin = { x: Math.min(target.x, opposite.x), y: Math.min(target.y, opposite.y) };
    next.width = Math.abs(target.x - opposite.x); next.height = Math.abs(target.y - opposite.y);
    if (next.width <= 1e-9 || next.height <= 1e-9) throw new Error("Invalid rectangle size");
    return next;
  }
  if (grip.key === "offset") {
    const [a, b] = entity.points;
    const length = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    next.offset = entity.dimensionType === "horizontal" ? target.y - a.y : entity.dimensionType === "vertical" ? target.x - a.x : (-(b.y - a.y) * (target.x - a.x) + (b.x - a.x) * (target.y - a.y)) / length;
    return next;
  }
  if (grip.key === "points" || grip.key === "controlPoints") next[grip.key][grip.index] = { ...target };
  else if (["radius", "radiusX", "radiusY"].includes(grip.key)) {
    const dx = target.x - entity.center.x, dy = target.y - entity.center.y;
    const angle = (entity.rotation ?? 0) * Math.PI / 180 + (grip.key === "radiusY" ? Math.PI / 2 : 0);
    next[grip.key] = grip.key === "radius" ? Math.hypot(dx, dy) : Math.abs(dx * Math.cos(angle) + dy * Math.sin(angle));
    if (next[grip.key] <= 1e-9 || (next.type === "ellipse" && next.radiusY > next.radiusX)) throw new Error("Invalid radius");
  } else next[grip.key] = Math.atan2(target.y - entity.center.y, target.x - entity.center.x) * 180 / Math.PI;
  return next;
}
