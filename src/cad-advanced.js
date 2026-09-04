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

/**
 * 指定軸(2点)に対する線対称変換。MIRRORコマンドの中核。
 * line/polyline/rect/circle/text/block/hatch/dimensionをサポートする。
 * rectは原点+幅高の表現のため、線対称変換後は閉じたpolyline(4頂点)として返す
 * (DXF LWPOLYLINE往復と同じ写像。向きが変わるとrect表現では保持できないため)。
 * @param entity a CAD entity from cad-core.js
 * @param {{x:number,y:number}} axisStart
 * @param {{x:number,y:number}} axisEnd
 * @returns entity 変換後のentity(rect→polylineへ型が変わり得る)
 */
export function mirrorEntity(entity, axisStart, axisEnd) {
  const a = normalizePoint(axisStart);
  const b = normalizePoint(axisEnd);
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  if (length < EPSILON) throw new Error("鏡像軸の2点が同一です。");
  const reflect = (point) => {
    // 線分abへの垂線の足を求め、2倍に伸ばす(線対称)
    const t = ((point.x - a.x) * (b.x - a.x) + (point.y - a.y) * (b.y - a.y)) / (length * length);
    const footX = a.x + t * (b.x - a.x);
    const footY = a.y + t * (b.y - a.y);
    return { x: 2 * footX - point.x, y: 2 * footY - point.y };
  };

  if (entity.type === "rect") {
    const origin = normalizePoint(entity.origin);
    const corners = [
      origin,
      { x: origin.x + entity.width, y: origin.y },
      { x: origin.x + entity.width, y: origin.y + entity.height },
      { x: origin.x, y: origin.y + entity.height }
    ].map(reflect);
    return {
      ...structuredClone(entity),
      type: "polyline",
      points: corners,
      closed: true,
      width: undefined,
      height: undefined,
      origin: undefined
    };
  }
  const next = structuredClone(entity);
  for (const key of ["origin", "center", "at", "insertion"]) {
    if (next[key]) next[key] = reflect(next[key]);
  }
  if (next.points) next.points = next.points.map(reflect);
  // ブロックのchildrenはローカル座標のため、挿入点を原点とするローカル軸で反転する
  if (next.children) {
    const insertion = normalizePoint(entity.insertion ?? { x: 0, y: 0 });
    const localStart = { x: a.x - insertion.x, y: a.y - insertion.y };
    const localEnd = { x: b.x - insertion.x, y: b.y - insertion.y };
    next.children = next.children.map((child) => mirrorEntity(child, localStart, localEnd));
  }
  // ブロック回転角は鏡像で符号反転する
  if (typeof next.rotation === "number") next.rotation = -next.rotation;
  return next;
}

/**
 * 矩形配列(ARRAY)。元entityをcols×rowsグリッドへ複写したentity配列を返す
 * (元entity自体は含まない。間隔はグリッド軸方向の絶対距離)。
 * @param entity a CAD entity from cad-core.js
 * @param {number} cols 列数(1以上)
 * @param {number} rows 行数(1以上)
 * @param {number} colDistance 列間隔
 * @param {number} rowDistance 行間隔
 * @returns {object[]} 複写されたentity群
 */
export function arrayEntity(entity, cols, rows, colDistance, rowDistance) {
  const columns = Math.max(1, Math.round(Number(cols) || 1));
  const rowCount = Math.max(1, Math.round(Number(rows) || 1));
  if (!Number.isFinite(Number(colDistance)) || !Number.isFinite(Number(rowDistance))) {
    throw new Error("配列間隔を数値で指定してください。");
  }
  const copies = [];
  for (let row = 0; row < rowCount; row += 1) {
    for (let col = 0; col < columns; col += 1) {
      if (row === 0 && col === 0) continue; // 元位置はコピーしない
      const next = transformEntity(entity, { dx: col * Number(colDistance), dy: row * Number(rowDistance) });
      next.id = `e_array_${randomId()}`;
      next.meta = { createdBy: "user", createdAt: new Date().toISOString() };
      copies.push(next);
    }
  }
  return copies;
}

/**
 * 線分またはポリラインを指定点で分割する。BREAKコマンドの中核。
 * line: 2本のlineを返す。polyline(開): 分割位置で2本のpolylineを返す。
 * rect/circle/block等は対象外(エラー)。
 * @param entity a CAD entity(lineまたは開polyline)
 * @param {{x:number,y:number}} point 分割点(線上またはその近傍)
 * @returns {object[]} 分割後のentity群(2件)
 */
export function breakEntity(entity, point) {
  const p = normalizePoint(point);
  if (entity.type === "line") {
    const segments = splitSegment(entity.points[0], entity.points[1], p);
    if (!segments) throw new Error("分割点が線分上にありません。");
    const [left, right] = segments;
    return [
      lineLike(entity, [left.a, left.b]),
      lineLike(entity, [right.a, right.b])
    ];
  }
  if (entity.type === "polyline") {
    if (entity.closed) throw new Error("閉じたポリラインの分割は現状未対応です。");
    const split = splitPolyline(entity.points, p);
    if (!split) throw new Error("分割点がポリライン上にありません。");
    return split.map((points) => lineLike(entity, points, { polyline: true }));
  }
  throw new Error(`${entity.type}は分割対象外です(線分または開ポリラインのみ)。`);
}

/**
 * 同一線上で端点が接する(または重なる)2線分を1本へ結合する。JOINコマンドの中核。
 * @param firstEntity line
 * @param secondEntity line
 * @param {number} [tolerance] 端点一致の許容距離(既定1e-6)
 * @returns {object|null} 結合後のline。結合できない場合はnull
 */
export function joinLines(firstEntity, secondEntity, tolerance = 1e-6) {
  if (firstEntity.type !== "line" || secondEntity.type !== "line") return null;
  const [a1, a2] = firstEntity.points;
  const [b1, b2] = secondEntity.points;
  const endpoints = [a1, a2, b1, b2];
  // 共有端点(許容差内で一致)のペアを探す
  const shared = [];
  for (let i = 0; i < 2; i += 1) {
    for (let j = 0; j < 2; j += 1) {
      if (Math.hypot(endpoints[i].x - endpoints[2 + j].x, endpoints[i].y - endpoints[2 + j].y) <= tolerance) {
        shared.push([i, 2 + j]);
      }
    }
  }
  if (shared.length === 0) return null;
  const [si, sj] = shared[0];
  const outerFirst = si === 0 ? endpoints[1] : endpoints[0];
  const outerSecond = sj === 2 ? endpoints[3] : endpoints[2];
  // 同一直線性の確認(外側2点+共有点が一直線=面積0)
  const cross = (outerSecond.x - outerFirst.x) * (endpoints[si].y - outerFirst.y) - (outerSecond.y - outerFirst.y) * (endpoints[si].x - outerFirst.x);
  if (Math.abs(cross) > 1e-6 * Math.max(1, Math.hypot(outerSecond.x - outerFirst.x, outerSecond.y - outerFirst.y))) return null;
  return lineLike(firstEntity, [outerFirst, outerSecond]);
}

function lineLike(source, points, options = {}) {
  const next = structuredClone(source);
  next.type = options.polyline ? "polyline" : "line";
  next.id = options.id ?? `e_${randomId()}`;
  next.points = points;
  next.meta = { ...(next.meta ?? {}), createdBy: "user", createdAt: new Date().toISOString() };
  if (options.polyline) next.closed = false;
  return next;
}

// 点p(線分abの近傍)で線分を2分割する。pが線分の範囲外ならnull。
function splitSegment(aRaw, bRaw, p) {
  const a = normalizePoint(aRaw);
  const b = normalizePoint(bRaw);
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const lengthSquared = abx * abx + aby * aby;
  if (lengthSquared < EPSILON) return null;
  const t = ((p.x - a.x) * abx + (p.y - a.y) * aby) / lengthSquared;
  if (t < 1e-9 || t > 1 - 1e-9) return null;
  const foot = { x: a.x + t * abx, y: a.y + t * aby };
  return [
    { a, b: foot },
    { a: foot, b }
  ];
}

// 開ポリラインの各セグメント上で点pに最も近い位置を分割点とし、2本のpolylineへ分ける。
// クリック位置はOSnap等で線上の点に吸着済みだが、数値入力では微小な誤差があり得るため
// 許容距離はセグメント長に対する相対値で判定する。
function splitPolyline(pointsRaw, p) {
  const points = pointsRaw.map(normalizePoint);
  if (points.length < 2) return null;
  let best = null;
  let bestDistance = Infinity;
  let bestIndex = -1;
  for (let i = 0; i < points.length - 1; i += 1) {
    const segment = splitSegment(points[i], points[i + 1], p);
    if (!segment) continue;
    const foot = segment[0].b;
    const segmentLength = Math.hypot(points[i + 1].x - points[i].x, points[i + 1].y - points[i].y);
    const d = Math.hypot(foot.x - p.x, foot.y - p.y);
    if (d < bestDistance) {
      bestDistance = d;
      bestIndex = i;
      best = foot;
    }
    // セグメント長の1%以内の近傍点のみ「ポリライン上」とみなす
    const tolerance = Math.max(1e-6, segmentLength * 0.01);
    if (d <= tolerance) {
      return [
        points.slice(0, i + 1).concat([foot]),
        [foot].concat(points.slice(i + 1))
      ];
    }
  }
  if (bestIndex < 0) return null;
  return null;
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
