import { line } from "./cad-core.js";
import { transformEntity } from "./cad-advanced.js";
import { blockWorldEntities } from "./cad-affine.js";
import { selectionBounds } from "./cad-selection.js";

export function stretchEntity(entity, a, b, delta) {
  if (![delta.x, delta.y].every(Number.isFinite)) throw new Error("Invalid displacement");
  if (!["line", "polyline", "hatch", "spline"].includes(entity.type)) throw new Error("STRETCH: LINE/PLINE/HATCH/SPLINE only");
  const box = selectionBounds(a, b);
  const key = entity.type === "spline" ? "controlPoints" : "points";
  const next = structuredClone(entity);
  next[key] = next[key].map((p) => p.x >= box.minX && p.x <= box.maxX && p.y >= box.minY && p.y <= box.maxY ? { x: p.x + delta.x, y: p.y + delta.y } : p);
  return next;
}

export function explodeEntity(entity) {
  if (entity.type === "block") {
    if (!entity.children?.length) throw new Error("EXPLODE: empty block");
    if (Object.keys(entity.attributes ?? {}).length || entity.attributeReferences?.length) throw new Error("EXPLODE: attributed blocks require attribute conversion");
    if (entity.definitionId) return blockWorldEntities(entity).map((child) => {
      const next = structuredClone(child);
      delete next.dxfRecordId;
      next.id = `e_explode_${crypto.randomUUID()}`;
      return next;
    });
    return entity.children.map((child) => ({
      ...transformEntity(child.type === "rect" ? {
        ...child, type: "polyline", closed: true,
        points: explodeEntity(child).map((edge) => edge.points[0])
      } : child, { dx: entity.insertion.x, dy: entity.insertion.y, angle: entity.rotation ?? 0, scale: entity.scale ?? 1 }),
      layerId: entity.definitionId ? child.layerId : entity.layerId,
      id: `e_explode_${crypto.randomUUID()}`
    }));
  }
  let points = entity.points;
  if (entity.type === "rect") {
    const { x, y } = entity.origin;
    points = [{ x, y }, { x: x + entity.width, y }, { x: x + entity.width, y: y + entity.height }, { x, y: y + entity.height }];
  } else if (entity.type !== "polyline") throw new Error("EXPLODE: BLOCK/RECT/PLINE only");
  const path = entity.closed || entity.type === "rect" ? [...points, points[0]] : points;
  return path.slice(1).map((p, i) => line(entity.layerId, path[i], p, { style: structuredClone(entity.style ?? {}) }));
}

export function matchProperties(source, target) {
  return { ...structuredClone(target), layerId: source.layerId, style: structuredClone(source.style ?? {}) };
}

export function lengthenEntity(entity, length) {
  if (!Number.isFinite(length) || length <= 1e-9) throw new Error("LENGTHEN: positive total length required");
  const next = structuredClone(entity);
  if (entity.type === "line") {
    const [a, b] = entity.points;
    const original = Math.hypot(b.x - a.x, b.y - a.y);
    if (original <= 1e-9) throw new Error("LENGTHEN: zero length line");
    next.points[1] = { x: a.x + (b.x - a.x) * length / original, y: a.y + (b.y - a.y) * length / original };
  } else if (entity.type === "arc") {
    const sweep = length / entity.radius * 180 / Math.PI;
    if (!Number.isFinite(sweep) || sweep >= 360 || sweep <= 1e-9) throw new Error("LENGTHEN: arc must be shorter than a circle");
    next.endAngle = entity.startAngle + sweep;
  } else throw new Error("LENGTHEN: LINE/ARC only");
  return next;
}

export function reverseEntity(entity) {
  const next = structuredClone(entity);
  if (["line", "polyline"].includes(entity.type)) next.points.reverse();
  else if (entity.type === "spline") {
    next.controlPoints.reverse();
    const sum = next.knots[0] + next.knots.at(-1);
    next.knots = next.knots.reverse().map((value) => sum - value);
  } else throw new Error("REVERSE: LINE/PLINE/SPLINE only");
  return next;
}

export function unusedLayerIds(drawing, currentLayerId) {
  const used = new Set([currentLayerId]);
  const visit = (entity) => {
    used.add(entity.layerId);
    for (const attribute of entity.attributeReferences ?? []) used.add(attribute.layerId);
    for (const child of entity.children ?? []) visit(child);
  };
  drawing.entities.forEach(visit);
  for (const definition of drawing.blockDefinitions ?? []) {
    definition.entities.forEach(visit);
    definition.attributeDefinitions.forEach((attribute) => used.add(attribute.layerId));
  }
  const keep = drawing.layers.find((layer) => layer.id === currentLayerId)?.id ?? drawing.layers[0]?.id;
  used.add(keep);
  return drawing.layers.filter((layer) => !used.has(layer.id) && !layer.locked).map((layer) => layer.id);
}

export function duplicateEntityIds(drawing, entities) {
  const protectedIds = new Set(drawing.entities.flatMap((entity) => entity.references?.map((ref) => ref.entityId) ?? []));
  const locked = new Set(drawing.layers.filter((layer) => layer.locked).map((layer) => layer.id));
  const canonical = (value) => {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
    return value;
  };
  const seen = new Set(), duplicates = [];
  for (const entity of entities) {
    if (!["line", "circle"].includes(entity.type)) continue;
    const geometry = entity.type === "line" ? [...entity.points].sort((a, b) => a.x - b.x || a.y - b.y) : { center: entity.center, radius: entity.radius };
    const { id, points, center, radius, meta, ...properties } = entity;
    const { createdAt, createdBy, ...metadata } = meta ?? {};
    const key = JSON.stringify(canonical({ properties, metadata, geometry }));
    if (seen.has(key) && !protectedIds.has(entity.id) && !locked.has(entity.layerId)) duplicates.push(entity.id);
    else seen.add(key);
  }
  return duplicates;
}
