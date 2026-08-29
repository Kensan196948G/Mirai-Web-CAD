const EPSILON = 1e-9;

export function transformEntity(entity, { dx = 0, dy = 0, angle = 0, scale = 1, base = { x: 0, y: 0 } } = {}) {
  const next = structuredClone(entity);
  const transform = (point) => {
    const x = (point.x - base.x) * scale;
    const y = (point.y - base.y) * scale;
    const radians = (angle * Math.PI) / 180;
    return {
      x: base.x + x * Math.cos(radians) - y * Math.sin(radians) + dx,
      y: base.y + x * Math.sin(radians) + y * Math.cos(radians) + dy
    };
  };
  for (const key of ["origin", "center", "at", "insertion"]) {
    if (next[key]) next[key] = transform(next[key]);
  }
  if (next.points) next.points = next.points.map(transform);
  if (next.children) next.children = next.children.map((child) => transformEntity(child, { dx, dy, angle, scale, base }));
  if (typeof next.radius === "number") next.radius = Math.abs(next.radius * scale);
  if (typeof next.width === "number") next.width *= scale;
  if (typeof next.height === "number") next.height *= scale;
  if (typeof next.size === "number") next.size = Math.abs(next.size * scale);
  if (typeof next.offset === "number") next.offset *= scale;
  if (typeof next.rotation === "number") next.rotation += angle;
  return next;
}

export function offsetEntity(entity, distance) {
  if (!Number.isFinite(distance) || Math.abs(distance) < EPSILON) throw new Error("オフセット距離を指定してください。");
  const next = structuredClone(entity);
  if (next.type === "line") {
    const [a, b] = next.points;
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    if (length < EPSILON) throw new Error("長さ0の線はオフセットできません。");
    const delta = { x: (-(b.y - a.y) / length) * distance, y: ((b.x - a.x) / length) * distance };
    next.points = next.points.map((point) => ({ x: point.x + delta.x, y: point.y + delta.y }));
  } else if (next.type === "circle") {
    next.radius += distance;
    if (next.radius <= EPSILON) throw new Error("オフセット後の半径が0以下です。");
  } else if (next.type === "rect") {
    next.origin = { x: next.origin.x - distance, y: next.origin.y - distance };
    next.width += distance * 2;
    next.height += distance * 2;
    if (Math.abs(next.width) < EPSILON || Math.abs(next.height) < EPSILON) throw new Error("オフセット後の矩形が無効です。");
  } else if (next.type === "polyline" || next.type === "hatch") {
    const center = centroid(next.points);
    next.points = next.points.map((point) => {
      const length = Math.hypot(point.x - center.x, point.y - center.y) || 1;
      return { x: point.x + ((point.x - center.x) / length) * distance, y: point.y + ((point.y - center.y) / length) * distance };
    });
  } else {
    throw new Error(`${entity.type}はオフセット対象外です。`);
  }
  return next;
}

export function editLineEndpoint(entity, point, mode) {
  if (entity.type !== "line") throw new Error(`${mode}は線分だけに対応しています。`);
  const next = structuredClone(entity);
  const distances = next.points.map((value) => Math.hypot(value.x - point.x, value.y - point.y));
  const index = distances[0] <= distances[1] ? 0 : 1;
  next.points[index] = { x: point.x, y: point.y };
  if (Math.hypot(next.points[0].x - next.points[1].x, next.points[0].y - next.points[1].y) < EPSILON) {
    throw new Error(`${mode}後の線分が長さ0になります。`);
  }
  return next;
}

export function dimensionEntity(layerId, start, end, options = {}) {
  return {
    id: options.id ?? `e_dim_${randomId()}`,
    type: "dimension",
    layerId,
    points: [normalizePoint(start), normalizePoint(end)],
    offset: Number(options.offset ?? 350),
    precision: Math.max(0, Math.min(6, Number(options.precision ?? 0))),
    suffix: String(options.suffix ?? ""),
    style: { strokeWidth: 1.5, lineDash: [], fill: "transparent", ...(options.style ?? {}) },
    meta: metadata(options)
  };
}

export function hatchEntity(layerId, points, options = {}) {
  if (!Array.isArray(points) || points.length < 3) throw new Error("ハッチ境界には3点以上必要です。");
  return {
    id: options.id ?? `e_hatch_${randomId()}`,
    type: "hatch",
    layerId,
    points: points.map(normalizePoint),
    pattern: options.pattern ?? "ANSI31",
    spacing: Math.max(20, Number(options.spacing ?? 180)),
    angle: Number(options.angle ?? 45),
    style: { strokeWidth: 1, lineDash: [], fill: "transparent", ...(options.style ?? {}) },
    meta: metadata(options)
  };
}

export function blockEntity(layerId, name, insertion, children, attributes = {}, options = {}) {
  if (!String(name).trim()) throw new Error("ブロック名が必要です。");
  if (!Array.isArray(children) || children.length === 0) throw new Error("ブロックには図形が必要です。");
  return {
    id: options.id ?? `e_block_${randomId()}`,
    type: "block",
    layerId,
    name: String(name).trim().slice(0, 80),
    insertion: normalizePoint(insertion),
    children: structuredClone(children),
    attributes: Object.fromEntries(Object.entries(attributes).map(([key, value]) => [String(key).slice(0, 40), String(value).slice(0, 200)])),
    rotation: Number(options.rotation ?? 0),
    scale: Number(options.scale ?? 1),
    style: { strokeWidth: 1.5, lineDash: [], fill: "transparent" },
    meta: metadata(options)
  };
}

export function measurePoints(start, end) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  return { dx, dy, distance: Math.hypot(dx, dy), angle: (Math.atan2(dy, dx) * 180) / Math.PI };
}

function centroid(points) {
  return points.reduce((sum, point) => ({ x: sum.x + point.x / points.length, y: sum.y + point.y / points.length }), { x: 0, y: 0 });
}

function normalizePoint(value) {
  return Array.isArray(value) ? { x: Number(value[0]), y: Number(value[1]) } : { x: Number(value.x), y: Number(value.y) };
}

function metadata(options) {
  return { createdBy: options.createdBy ?? "user", createdAt: options.createdAt ?? new Date().toISOString() };
}

function randomId() {
  return globalThis.crypto?.randomUUID?.().slice(0, 8) ?? Math.random().toString(16).slice(2, 10);
}
