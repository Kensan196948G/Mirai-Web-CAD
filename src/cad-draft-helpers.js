/**
 * Pure geometry helpers for interactive drafting aids (orthogonal constraint,
 * endpoint snapping). Kept separate from src/app.js so they stay unit-testable
 * without a DOM/canvas, and so src/app.js does not grow further as a single
 * monolithic UI module (see docs/production-readiness-assessment.md).
 */

/**
 * Constrain `point` relative to `anchor` to the nearer of the horizontal or
 * vertical axis, matching AutoCAD-style ORTHO behaviour: whichever axis has
 * the larger absolute delta from the anchor wins, the other is pinned to the
 * anchor's value.
 * @param {{x:number,y:number}|null|undefined} anchor
 * @param {{x:number,y:number}} point
 * @returns {{x:number,y:number}}
 */
export function applyOrtho(anchor, point) {
  if (!anchor) return point;
  const dx = Math.abs(point.x - anchor.x);
  const dy = Math.abs(point.y - anchor.y);
  return dx >= dy ? { x: point.x, y: anchor.y } : { x: anchor.x, y: point.y };
}

/**
 * Candidate OSnap points for one entity: endpoints/corners/centers a drafter
 * would expect to snap to. Intentionally coarse (no midpoints/intersections)
 * to keep the scan cheap for large drawings.
 * @param entity a CAD entity from cad-core.js (line/rect/circle/polyline/text/dimension/hatch/block)
 * @returns {{x:number,y:number}[]}
 */
export function entityKeyPoints(entity) {
  if (entity.type === "line" || entity.type === "dimension") return entity.points.slice();
  if (entity.type === "polyline" || entity.type === "hatch") return entity.points.slice();
  if (entity.type === "rect") {
    const o = entity.origin;
    return [
      o,
      { x: o.x + entity.width, y: o.y },
      { x: o.x + entity.width, y: o.y + entity.height },
      { x: o.x, y: o.y + entity.height }
    ];
  }
  if (entity.type === "circle") {
    const c = entity.center;
    const r = entity.radius;
    return [c, { x: c.x + r, y: c.y }, { x: c.x - r, y: c.y }, { x: c.x, y: c.y + r }, { x: c.x, y: c.y - r }];
  }
  if (entity.type === "text") return [entity.at];
  if (entity.type === "block") return entity.insertion ? [entity.insertion] : [];
  return [];
}

/**
 * Nearest OSnap candidate across all visible entities within `toleranceWorld`
 * of `worldPoint`, or null if none qualifies.
 * @param drawing a CAD drawing from cad-core.js ({layers, entities})
 * @param {{x:number,y:number}} worldPoint
 * @param {number} toleranceWorld world-unit search radius
 * @returns {{x:number,y:number}|null}
 */
export function findOsnapPoint(drawing, worldPoint, toleranceWorld) {
  const visibleLayerIds = new Set(drawing.layers.filter((layer) => layer.visible).map((layer) => layer.id));
  let best = null;
  let bestDistance = Infinity;
  for (const entity of drawing.entities) {
    if (!visibleLayerIds.has(entity.layerId)) continue;
    for (const candidate of entityKeyPoints(entity)) {
      const current = Math.hypot(candidate.x - worldPoint.x, candidate.y - worldPoint.y);
      if (current < toleranceWorld && current < bestDistance) {
        best = candidate;
        bestDistance = current;
      }
    }
  }
  return best;
}
