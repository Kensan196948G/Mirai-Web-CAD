import { line } from "./cad-core.js";
import { transformEntity } from "./cad-advanced.js";
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
    if (Object.keys(entity.attributes ?? {}).length) throw new Error("EXPLODE: attributed blocks require attribute conversion");
    return entity.children.map((child) => ({
      ...transformEntity(child.type === "rect" ? {
        ...child, type: "polyline", closed: true,
        points: explodeEntity(child).map((edge) => edge.points[0])
      } : child, { dx: entity.insertion.x, dy: entity.insertion.y, angle: entity.rotation ?? 0, scale: entity.scale ?? 1 }),
      layerId: entity.layerId,
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
