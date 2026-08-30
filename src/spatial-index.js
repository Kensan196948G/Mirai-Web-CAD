import { boundsIntersect, entityBounds } from "./cad-core.js";

const DEFAULT_CELL_SIZE = 1000;

export function buildSpatialIndex(entities, cellSize = DEFAULT_CELL_SIZE) {
  const cells = new Map();
  const entries = [];
  const unbounded = [];

  entities.forEach((entity) => {
    const bounds = entityBounds(entity);
    if (!bounds) {
      unbounded.push(entity);
      return;
    }
    const entryIndex = entries.length;
    entries.push({ entity, bounds });
    const minCx = Math.floor(bounds.minX / cellSize);
    const maxCx = Math.floor(bounds.maxX / cellSize);
    const minCy = Math.floor(bounds.minY / cellSize);
    const maxCy = Math.floor(bounds.maxY / cellSize);
    for (let cx = minCx; cx <= maxCx; cx += 1) {
      for (let cy = minCy; cy <= maxCy; cy += 1) {
        const key = `${cx}:${cy}`;
        let bucket = cells.get(key);
        if (!bucket) {
          bucket = [];
          cells.set(key, bucket);
        }
        bucket.push(entryIndex);
      }
    }
  });

  return { cellSize, cells, entries, unbounded };
}

export function queryBounds(index, viewport) {
  const result = [...index.unbounded];
  if (!viewport) {
    for (const entry of index.entries) result.push(entry.entity);
    return result;
  }

  const { cellSize, cells, entries } = index;
  const minCx = Math.floor(viewport.minX / cellSize);
  const maxCx = Math.floor(viewport.maxX / cellSize);
  const minCy = Math.floor(viewport.minY / cellSize);
  const maxCy = Math.floor(viewport.maxY / cellSize);
  const seen = new Set();
  for (let cx = minCx; cx <= maxCx; cx += 1) {
    for (let cy = minCy; cy <= maxCy; cy += 1) {
      const bucket = cells.get(`${cx}:${cy}`);
      if (!bucket) continue;
      for (const entryIndex of bucket) {
        if (seen.has(entryIndex)) continue;
        seen.add(entryIndex);
        const entry = entries[entryIndex];
        if (boundsIntersect(entry.bounds, viewport)) result.push(entry.entity);
      }
    }
  }
  return result;
}
