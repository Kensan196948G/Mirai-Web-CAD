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
  } else if (next.type === "polyline") {
    next.points = parallelOffsetPoints(next.points, Boolean(next.closed), distance);
    if (next.points.length === 0) throw new Error("オフセット後のポリラインが無効です。");
  } else if (next.type === "hatch") {
    // ハッチ境界は閉領域として扱う(輪郭を平行移動した閉ポリラインを再構築する)
    const offsetPoints = parallelOffsetPoints(next.points, true, distance);
    if (offsetPoints.length === 0) throw new Error("オフセット後のハッチ境界が無効です。");
    next.points = offsetPoints;
  } else {
    throw new Error(`${entity.type}はオフセット対象外です。`);
  }
  return next;
}

/**
 * ポリライン/ハッチ境界の「真の平行オフセット」を計算する。
 * 従来の重心基準の放射移動(コーナーで形状が歪む)を置き換える。
 *
 * 方式: 各セグメントを法線方向へdistanceだけ平行移動した「オフセット直線」を作り、
 * 隣接する2つのオフセット直線の交点で新頂点を構成する(miter join)。
 * - 閉ポリライン: 全ての頂点が隣接セグメントのオフセット直線の交点になる。
 *   符号付き面積から内外を判定し、distance>0で外側・<0で内側へオフセットする。
 * - 開ポリライン: 両端は端セグメントの法線方向へ移動し、中間頂点はmiter join。
 *   正のdistanceは進行方向の左側へオフセット(lineと同じ符号規則)。
 * 直線セグメントのみ対応(円弧バルジは非対応)。
 *
 * @param {{x:number,y:number}[]} points
 * @param {boolean} closed
 * @param {number} distance オフセット距離(符号付き)
 * @returns {{x:number,y:number}[]} オフセット後の頂点列(失敗時は空配列)
 */
export function parallelOffsetPoints(points, closed, distance) {
  if (!Array.isArray(points) || points.length < 2) return [];
  const count = points.length;
  const closedShape = closed && count >= 3;
  const segmentCount = closedShape ? count : count - 1;

  // 各セグメントの単位方向と、オフセット方向(外向き法線×distance)を準備する
  // オフセット方向はセグメント単位で一定である必要がある(頂点毎に変えると形状が歪む)
  const offsets = [];
  for (let i = 0; i < segmentCount; i += 1) {
    const a = points[i];
    const b = closedShape ? points[(i + 1) % count] : points[i + 1];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const length = Math.hypot(dx, dy);
    if (length < EPSILON) return [];
    const dirX = dx / length;
    const dirY = dy / length;
    // 左法線(進行方向に対して左)
    const leftX = -dirY;
    const leftY = dirX;
    // 閉多角形では符号付き面積から外向きを決める(反時計回り=左が内側なので反転)
    let offsetX = leftX * distance;
    let offsetY = leftY * distance;
    if (closedShape && signedArea(points) > 0) {
      offsetX = -offsetX;
      offsetY = -offsetY;
    }
    offsets.push({ x: offsetX, y: offsetY });
  }

  // セグメントiのオフセット直線: (points[i]+off[i]) → (points[i+1]+off[i])
  const segmentStart = (i) => (closedShape ? points[i] : points[i]);
  const segmentEnd = (i) => (closedShape ? points[(i + 1) % count] : points[i + 1]);

  const offsetLineStart = (i) => ({ x: segmentStart(i).x + offsets[i].x, y: segmentStart(i).y + offsets[i].y });
  const offsetLineEnd = (i) => ({ x: segmentEnd(i).x + offsets[i].x, y: segmentEnd(i).y + offsets[i].y });

  const result = [];
  if (closedShape) {
    // 頂点i = セグメント(i-1)とセグメント(i)のオフセット直線の交点
    for (let i = 0; i < count; i += 1) {
      const prev = (i - 1 + segmentCount) % segmentCount;
      const vertex = lineIntersection(offsetLineStart(prev), offsetLineEnd(prev), offsetLineStart(i), offsetLineEnd(i));
      if (!vertex) return [];
      result.push(vertex);
    }
    return result;
  }

  // 開ポリライン: 先頭はセグメント0のオフセット直線の始点、末尾は最後のセグメントのオフセット直線の終点
  const last = segmentCount - 1;
  result.push(offsetLineStart(0));
  for (let i = 1; i < segmentCount; i += 1) {
    const vertex = lineIntersection(offsetLineStart(i - 1), offsetLineEnd(i - 1), offsetLineStart(i), offsetLineEnd(i));
    if (!vertex) return [];
    result.push(vertex);
  }
  result.push(offsetLineEnd(last));
  return result;
}

/** 多角形の符号付き面積(正=反時計回り)。 */
function signedArea(points) {
  let area = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    area += a.x * b.y - b.x * a.y;
  }
  return area / 2;
}

/** 2直線(p1-p2, q1-q2)の交点。平行/同一線上ならnull。 */
function lineIntersection(p1, p2, q1, q2) {
  const d1x = p2.x - p1.x;
  const d1y = p2.y - p1.y;
  const d2x = q2.x - q1.x;
  const d2y = q2.y - q1.y;
  const denom = d1x * d2y - d1y * d2x;
  if (Math.abs(denom) < EPSILON) return null;
  const t = ((q1.x - p1.x) * d2y - (q1.y - p1.y) * d2x) / denom;
  return { x: p1.x + t * d1x, y: p1.y + t * d1y };
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
  const columns = Math.round(Number(cols) || 0);
  const rowCount = Math.round(Number(rows) || 0);
  if (!Number.isInteger(columns) || !Number.isInteger(rowCount) || columns < 1 || rowCount < 1) {
    throw new Error("列数・行数は1以上の整数で指定してください。");
  }
  if (!Number.isFinite(Number(colDistance)) || !Number.isFinite(Number(rowDistance))) {
    throw new Error("配列間隔を数値で指定してください。");
  }
  // ブラウザ凍結・メモリ枯渇を防ぐため、1回の複写で生成するentity数を上限で検証する
  // (既存のimport上限10,000と同等以下の、安全側の実務上限)。
  const MAX_ARRAY_COPIES = 1000;
  const copyCount = columns * rowCount - 1;
  if (copyCount > MAX_ARRAY_COPIES) {
    throw new Error(`配列の複写数が多すぎます(上限 ${MAX_ARRAY_COPIES}件、指定 ${columns}×${rowCount}=${copyCount}件)。列数・行数を減らしてください。`);
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

// 点p(線分abの近傍)で線分を2分割する。
// 分割可能条件: (1) 投影係数tが線分の範囲内(端点を除く)、(2) 垂直距離(点と線分の距離)が
// 許容値以下。垂直距離を確認しないと線分から遠く離れた点でも分割されてしまう
// ((0,0)-(100,0)に対する(40,1000000)など)。
// @param tolerance 垂直距離の許容値(既定は線分長の1%)
function splitSegment(aRaw, bRaw, p, tolerance = null) {
  const a = normalizePoint(aRaw);
  const b = normalizePoint(bRaw);
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const lengthSquared = abx * abx + aby * aby;
  if (lengthSquared < EPSILON) return null;
  const t = ((p.x - a.x) * abx + (p.y - a.y) * aby) / lengthSquared;
  if (t < 1e-9 || t > 1 - 1e-9) return null;
  const foot = { x: a.x + t * abx, y: a.y + t * aby };
  const perpendicular = Math.hypot(foot.x - p.x, foot.y - p.y);
  const limit = tolerance ?? Math.max(1e-6, Math.sqrt(lengthSquared) * 0.01);
  if (perpendicular > limit) return null;
  return [
    { a, b: foot },
    { a: foot, b }
  ];
}

// 開ポリラインを、入力点に最も近い許容セグメント上の位置で2本のpolylineへ分ける。
// 最初に許容範囲へ入ったセグメントではなく、全セグメントを走査して最近傍を選ぶ
// (平行で近接する複数セグメントがある場合に誤った位置で分割しないため)。
function splitPolyline(pointsRaw, p) {
  const points = pointsRaw.map(normalizePoint);
  if (points.length < 2) return null;
  let best = null;
  let bestDistance = Infinity;
  let bestIndex = -1;
  for (let i = 0; i < points.length - 1; i += 1) {
    const segmentLength = Math.hypot(points[i + 1].x - points[i].x, points[i + 1].y - points[i].y);
    const tolerance = Math.max(1e-6, segmentLength * 0.01);
    const split = splitSegment(points[i], points[i + 1], p, tolerance);
    if (!split) continue;
    const foot = split[0].b;
    const d = Math.hypot(foot.x - p.x, foot.y - p.y);
    if (d < bestDistance) {
      bestDistance = d;
      bestIndex = i;
      best = foot;
    }
  }
  if (bestIndex < 0 || !best) return null;
  return [points.slice(0, bestIndex + 1).concat([best]), [best].concat(points.slice(bestIndex + 1))];
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

// --- 正確なTRIM/EXTEND(境界交点演算、機能カタログRound 5) ---

/**
 * 境界エンティティ群からクリップ・延長に使う直線セグメントを収集する。
 * line/rect/polyline/hatch/dimension が対象。円弧を含む形状は直線近似しない。
 * @param boundaries entity群
 * @returns {{a:{x,y},b:{x,y}}[]}
 */
export function collectBoundarySegments(boundaries) {
  const segments = [];
  for (const boundary of boundaries ?? []) {
    if (!boundary || typeof boundary !== "object") continue;
    if (boundary.type === "line") {
      if (boundary.points?.[0] && boundary.points?.[1]) segments.push({ a: boundary.points[0], b: boundary.points[1] });
    } else if (boundary.type === "rect") {
      if (!boundary.origin) continue;
      const o = boundary.origin;
      const corners = [
        o,
        { x: o.x + boundary.width, y: o.y },
        { x: o.x + boundary.width, y: o.y + boundary.height },
        { x: o.x, y: o.y + boundary.height }
      ];
      for (let i = 0; i < corners.length; i += 1) {
        segments.push({ a: corners[i], b: corners[(i + 1) % corners.length] });
      }
    } else if (boundary.type === "polyline" || boundary.type === "hatch") {
      if (!Array.isArray(boundary.points) || boundary.points.length < 2) continue;
      for (let i = 0; i < boundary.points.length - 1; i += 1) {
        segments.push({ a: boundary.points[i], b: boundary.points[i + 1] });
      }
      // hatchはclosedプロパティを持たないが常に閉領域として扱う(描画・面積計算と同じ解釈)。
      // polylineもclosed時に最終→先頭セグメントを追加する。
      const isClosed = boundary.type === "hatch" || boundary.closed === true;
      if (isClosed && boundary.points.length > 2) {
        segments.push({ a: boundary.points[boundary.points.length - 1], b: boundary.points[0] });
      }
    }
  }
  return segments;
}

/**
 * セグメントabをパラメータt(0〜1)で分割する位置を返す。点pの線分上への射影。
 * 射影tが線分範囲外の場合はnull(線分外のクリックを誤操作として弾く)。
 * @returns {{t:number,x:number,y:number}|null} pの射影が線分範囲内ならその座標
 */
function parameterizeOnSegment(a, b, p) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared < EPSILON) return null;
  const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSquared;
  if (t < 0 || t > 1) return null;
  return { t, x: a.x + t * dx, y: a.y + t * dy };
}

/**
 * 2直線セグメントの交点を、両セグメントのパラメータ(t1,t2)付きで返す。
 * 交差しない/平行/端点のみ接触の場合はnull。
 * @returns {{t1:number,t2:number,x:number,y:number}|null}
 */
function segmentIntersectionParam(seg1, seg2) {
  const p1 = seg1.a;
  const p2 = seg1.b;
  const q1 = seg2.a;
  const q2 = seg2.b;
  const d1x = p2.x - p1.x;
  const d1y = p2.y - p1.y;
  const d2x = q2.x - q1.x;
  const d2y = q2.y - q1.y;
  const denom = d1x * d2y - d1y * d2x;
  if (Math.abs(denom) < EPSILON) return null;
  const t1 = ((q1.x - p1.x) * d2y - (q1.y - p1.y) * d2x) / denom;
  const t2 = ((q1.x - p1.x) * d1y - (q1.y - p1.y) * d1x) / denom;
  const MARGIN = 1e-9;
  if (t1 < -MARGIN || t1 > 1 + MARGIN || t2 < -MARGIN || t2 > 1 + MARGIN) return null;
  // 端点のみの接触(共有端点)は交点とみなさない
  const t1End = t1 < MARGIN || t1 > 1 - MARGIN;
  const t2End = t2 < MARGIN || t2 > 1 - MARGIN;
  if (t1End && t2End) return null;
  return { t1: Math.max(0, Math.min(1, t1)), t2, x: p1.x + t1 * d1x, y: p1.y + t1 * d1y };
}

/**
 * TRIM: 対象エンティティを境界セグメント群との交点で切り、keepPointを含む区間を残す。
 * lineのみ対応(開polylineは頂点セグメントごとのクリップになるため対象外)。
 * @param entity lineエンティティ
 * @param boundaries 境界エンティティ群(他図形)
 * @param keepPoint 残す側を示すクリック点(対象線上)
 * @returns entity クリップ後のlineエンティティ
 */
export function trimEntityToBoundaries(entity, boundaries, keepPoint) {
  if (entity.type !== "line") throw new Error("TRIMは線分だけに対応しています。");
  const boundarySegments = collectBoundarySegments(boundaries);
  const target = { a: entity.points[0], b: entity.points[1] };
  const keep = parameterizeOnSegment(target.a, target.b, keepPoint);
  if (!keep) throw new Error("クリック点が線分上にありません。");
  // クリック点は対象線分の近傍(垂直距離が線分長の1%以内)でなければならない
  const segLength = Math.hypot(target.b.x - target.a.x, target.b.y - target.a.y);
  const perp = Math.hypot(keepPoint.x - keep.x, keepPoint.y - keep.y);
  if (perp > Math.max(1e-6, segLength * 0.01)) throw new Error("クリック点が線分上にありません。");

  const cutPoints = [];
  for (const seg of boundarySegments) {
    const hit = segmentIntersectionParam(target, seg);
    if (hit) cutPoints.push(hit.t1);
  }
  if (cutPoints.length === 0) throw new Error("境界と交差していません。");
  cutPoints.sort((x, y) => x - y);

  // keepPointのtを挟む直前・直後の交点で切る
  const t = keep.t;
  let left = 0;
  let right = 1;
  for (const cut of cutPoints) {
    if (cut < t && cut > left) left = cut;
    if (cut > t && cut < right) right = cut;
  }
  const pointAt = (param) => ({ x: target.a.x + (target.b.x - target.a.x) * param, y: target.a.y + (target.b.y - target.a.y) * param });
  const next = structuredClone(entity);
  next.points = [pointAt(left), pointAt(right)];
  return next;
}

/**
 * EXTEND: 対象線分のpickPointに近い端点を、延長方向で最初に交差する境界まで伸ばす。
 * lineのみ対応。境界と延長線上で交差しない場合はエラー。
 * @param entity lineエンティティ
 * @param boundaries 境界エンティティ群(他図形)
 * @param pickPoint どの端点を伸ばすかを示すクリック点
 * @returns entity 延長後のlineエンティティ
 */
export function extendEntityToBoundary(entity, boundaries, pickPoint) {
  if (entity.type !== "line") throw new Error("EXTENDは線分だけに対応しています。");
  const boundarySegments = collectBoundarySegments(boundaries);
  const [a, b] = entity.points;
  const pick = normalizePoint(pickPoint);
  // pickPointに近い端点を特定する
  const extendStart = Math.hypot(pick.x - a.x, pick.y - a.y) <= Math.hypot(pick.x - b.x, pick.y - b.y) ? a : b;
  const fixedEnd = extendStart === a ? b : a;
  const direction = {
    x: extendStart.x - fixedEnd.x,
    y: extendStart.y - fixedEnd.y
  };
  const rayLength = Math.hypot(direction.x, direction.y);
  if (rayLength < EPSILON) throw new Error("延長する線分の長さが0です。");
  const unit = { x: direction.x / rayLength, y: direction.y / rayLength };
  // 延長方向に十分長い仮想セグメント(図面対角相当の1e6倍)と境界の交点を探す
  const rayEnd = { x: extendStart.x + unit.x * rayLength * 1e6, y: extendStart.y + unit.y * rayLength * 1e6 };
  const ray = { a: extendStart, b: rayEnd };

  let best = null;
  let bestDistance = Infinity;
  for (const seg of boundarySegments) {
    const hit = segmentIntersectionParam(ray, seg);
    if (!hit) continue;
    const d = Math.hypot(hit.x - extendStart.x, hit.y - extendStart.y);
    if (d > EPSILON && d < bestDistance) {
      bestDistance = d;
      best = { x: hit.x, y: hit.y };
    }
  }
  if (!best) throw new Error("延長先の境界が見つかりません。");

  const next = structuredClone(entity);
  next.points = extendStart === a ? [best, b] : [a, best];
  return next;
}
