import { dxfGroup, inspectDxfSourceDocument } from "./dxf-source-document.js";
import { dimensionEntity, hatchEntity } from "./cad-advanced.js";

export const NATIVE_DXF_ENTITY_TYPES = new Set(["DIMENSION", "HATCH", "VIEWPORT"]);

const number = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const numeric = (record, code, fallback = 0) => number(dxfGroup(record, code, fallback), fallback);
const point = (record, code) => ({ x: numeric(record, code), y: numeric(record, code + 10) });
const values = (record, code) => record.groups.filter((group) => group.code === code).map((group) => group.value);
const decode = (value) => String(value ?? "").replace(/\\U\+([0-9a-f]{4})/gi, (_match, code) => String.fromCharCode(parseInt(code, 16)));

function metadata(record) {
  return {
    dxfRecordId: record.id,
    dxfHandle: dxfGroup(record, 5),
    paperSpace: numeric(record, 67, 0) === 1,
    layoutName: dxfGroup(record, 410, numeric(record, 67, 0) === 1 ? "Layout1" : "Model")
  };
}

function dimensionKind(baseType, angle) {
  if (baseType === 0) {
    const normalized = ((angle % 180) + 180) % 180;
    if (Math.abs(normalized) < 1e-9) return "horizontal";
    if (Math.abs(normalized - 90) < 1e-9) return "vertical";
    return "rotated";
  }
  return { 1: "aligned", 2: "angular", 3: "diameter", 4: "radius", 5: "angular", 6: "ordinate" }[baseType] ?? "aligned";
}

export function parseDxfDimension(record, layerId, index = 0, dimensionStyles = []) {
  const rawType = numeric(record, 70, 0);
  const baseType = rawType & 7;
  const angle = numeric(record, 50, 0);
  let points;
  if ([0, 1, 6].includes(baseType)) points = [point(record, 13), point(record, 14)];
  else if (baseType === 3) {
    const first = point(record, 10), second = point(record, 15);
    points = [{ x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 }, second];
  } else if (baseType === 4) points = [point(record, 10), point(record, 15)];
  else points = [point(record, 13), point(record, 14)];
  const kind = dimensionKind(baseType, angle);
  const styleName = decode(dxfGroup(record, 3, "STANDARD"));
  const dimensionStyle = dimensionStyles.find((style) => style.name.toUpperCase() === styleName.toUpperCase());
  const dimLinePoint = point(record, 10);
  let offset = 0;
  if (kind === "horizontal") offset = dimLinePoint.y - points[0].y;
  else if (kind === "vertical") offset = dimLinePoint.x - points[0].x;
  else if (["aligned", "rotated"].includes(kind)) {
    const radians = (kind === "rotated" ? angle : Math.atan2(points[1].y - points[0].y, points[1].x - points[0].x) * 180 / Math.PI) * Math.PI / 180;
    offset = (dimLinePoint.x - points[0].x) * -Math.sin(radians) + (dimLinePoint.y - points[0].y) * Math.cos(radians);
  }
  const entity = dimensionEntity(layerId, points[0], points[1], {
    id: `e_import_${index + 1}_${crypto.randomUUID().slice(0, 8)}`,
    dimensionType: kind,
    offset,
    precision: dimensionStyle?.precision ?? 0,
    textSize: dimensionStyle?.textSize > 0 ? dimensionStyle.textSize : 180,
    arrowSize: dimensionStyle?.arrowSize > 0 ? dimensionStyle.arrowSize : 120,
    measurementScale: dimensionStyle?.measurementScale > 0 ? dimensionStyle.measurementScale : 1,
    createdBy: "import"
  });
  return Object.assign(entity, metadata(record), {
    dxfDimensionType: rawType,
    dimensionStyleName: styleName,
    textOverride: decode(dxfGroup(record, 1, "<>")),
    tolerance: dimensionStyle ? { enabled: dimensionStyle.tolerance, limits: dimensionStyle.limits, upper: dimensionStyle.upperTolerance, lower: dimensionStyle.lowerTolerance, precision: dimensionStyle.tolerancePrecision } : null,
    dimensionLinePoint: dimLinePoint,
    textPoint: point(record, 11),
    definitionPoints: Object.fromEntries([10, 11, 12, 13, 14, 15, 16].filter((code) => values(record, code).length).map((code) => [String(code), point(record, code)])),
    dimensionLineAngle: angle,
    attachmentPoint: numeric(record, 71, 5)
  });
}

function pathCursor(record) {
  const start = record.groups.findIndex((group) => group.code === 91);
  return { groups: record.groups, index: start < 0 ? record.groups.length : start + 1 };
}

function take(cursor, code, fallback = undefined) {
  const group = cursor.groups[cursor.index];
  if (!group || group.code !== code) return fallback;
  cursor.index += 1;
  return group.value;
}

function sampleArc(center, radius, startAngle, endAngle, ccw) {
  let sweep = endAngle - startAngle;
  if (ccw && sweep <= 0) sweep += 360;
  if (!ccw && sweep >= 0) sweep -= 360;
  if (Math.abs(sweep) < 1e-9) sweep = ccw ? 360 : -360;
  const count = Math.max(8, Math.ceil(Math.abs(sweep) / 15));
  return Array.from({ length: count + 1 }, (_unused, index) => {
    const radians = (startAngle + sweep * index / count) * Math.PI / 180;
    return { x: center.x + radius * Math.cos(radians), y: center.y + radius * Math.sin(radians) };
  });
}

function sampleEllipse(center, majorAxis, ratio, startParameter, endParameter, ccw) {
  let sweep = endParameter - startParameter;
  const tau = Math.PI * 2;
  if (ccw && sweep <= 0) sweep += tau;
  if (!ccw && sweep >= 0) sweep -= tau;
  if (Math.abs(sweep) < 1e-9) sweep = ccw ? tau : -tau;
  const count = Math.max(16, Math.ceil(Math.abs(sweep) / (Math.PI / 12)));
  const minorAxis = { x: -majorAxis.y * ratio, y: majorAxis.x * ratio };
  return Array.from({ length: count + 1 }, (_unused, index) => {
    const parameter = startParameter + sweep * index / count;
    return { x: center.x + majorAxis.x * Math.cos(parameter) + minorAxis.x * Math.sin(parameter), y: center.y + majorAxis.y * Math.cos(parameter) + minorAxis.y * Math.sin(parameter) };
  });
}

function parsePolylinePath(cursor, flags) {
  const hasBulge = number(take(cursor, 72, 0)) === 1;
  const closed = number(take(cursor, 73, 1)) === 1;
  const count = number(take(cursor, 93, 0));
  const vertices = [];
  for (let index = 0; index < count; index += 1) {
    const x = number(take(cursor, 10));
    const y = number(take(cursor, 20));
    const bulge = cursor.groups[cursor.index]?.code === 42 ? number(take(cursor, 42)) : 0;
    vertices.push({ x, y, ...(bulge ? { bulge } : {}) });
  }
  const sourceCount = number(take(cursor, 97, 0));
  const sourceHandles = Array.from({ length: sourceCount }, () => String(take(cursor, 330, "")));
  return { type: "polyline", flags, closed, hasBulge, vertices, sourceHandles, points: vertices.map(({ x, y }) => ({ x, y })) };
}

function parseEdgePath(cursor, flags) {
  const count = number(take(cursor, 93, 0));
  const edges = [];
  for (let index = 0; index < count; index += 1) {
    const type = number(take(cursor, 72, 0));
    if (type === 1) {
      edges.push({ type: "line", start: { x: number(take(cursor, 10)), y: number(take(cursor, 20)) }, end: { x: number(take(cursor, 11)), y: number(take(cursor, 21)) } });
    } else if (type === 2) {
      edges.push({ type: "arc", center: { x: number(take(cursor, 10)), y: number(take(cursor, 20)) }, radius: number(take(cursor, 40)), startAngle: number(take(cursor, 50)), endAngle: number(take(cursor, 51)), ccw: number(take(cursor, 73, 1)) === 1 });
    } else if (type === 3) {
      edges.push({ type: "ellipse", center: { x: number(take(cursor, 10)), y: number(take(cursor, 20)) }, majorAxis: { x: number(take(cursor, 11)), y: number(take(cursor, 21)) }, ratio: number(take(cursor, 40), 1), startParameter: number(take(cursor, 50)), endParameter: number(take(cursor, 51)), ccw: number(take(cursor, 73, 1)) === 1 });
    } else {
      throw new Error(`HATCH境界edge type ${type}は未対応です。`);
    }
  }
  const sourceCount = number(take(cursor, 97, 0));
  const sourceHandles = Array.from({ length: sourceCount }, () => String(take(cursor, 330, "")));
  const points = [];
  for (const edge of edges) {
    const sampled = edge.type === "line" ? [edge.start, edge.end] : edge.type === "arc"
      ? sampleArc(edge.center, edge.radius, edge.startAngle, edge.endAngle, edge.ccw)
      : sampleEllipse(edge.center, edge.majorAxis, edge.ratio, edge.startParameter, edge.endParameter, edge.ccw);
    points.push(...(points.length ? sampled.slice(1) : sampled));
  }
  if (points.length > 1 && Math.hypot(points[0].x - points.at(-1).x, points[0].y - points.at(-1).y) < 1e-7) points.pop();
  return { type: "edges", flags, edges, sourceHandles, points };
}

export function parseDxfHatch(record, layerId, index = 0) {
  const cursor = pathCursor(record);
  const pathCount = numeric(record, 91, 0);
  const boundaries = [];
  for (let pathIndex = 0; pathIndex < pathCount; pathIndex += 1) {
    const flags = number(take(cursor, 92, 0));
    boundaries.push(flags & 2 ? parsePolylinePath(cursor, flags) : parseEdgePath(cursor, flags));
  }
  const outer = boundaries.find((boundary) => boundary.points.length >= 3)?.points;
  if (!outer) throw new Error("HATCH境界を復元できません。");
  const scale = numeric(record, 41, 1);
  const entity = hatchEntity(layerId, outer, {
    id: `e_import_${index + 1}_${crypto.randomUUID().slice(0, 8)}`,
    pattern: dxfGroup(record, 2, "SOLID"),
    spacing: Math.max(20, Math.abs(scale) * 180),
    angle: numeric(record, 52, 0),
    createdBy: "import"
  });
  const seedCount = numeric(record, 98, 0), allX = values(record, 10), allY = values(record, 20);
  return Object.assign(entity, metadata(record), {
    boundaries,
    solidFill: numeric(record, 70, 0) === 1,
    associative: numeric(record, 71, 0) === 1,
    hatchStyle: numeric(record, 75, 0),
    patternType: numeric(record, 76, 1),
    patternAngle: numeric(record, 52, 0),
    patternScale: scale,
    patternDouble: numeric(record, 77, 0) === 1,
    elevation: point(record, 10),
    seedPoints: seedCount ? allX.slice(-seedCount).map((x, seedIndex) => ({ x: number(x), y: number(allY.at(-seedCount + seedIndex)) })) : []
  });
}

export function parseDxfViewport(record, layerId, index = 0) {
  const width = numeric(record, 40, 1), height = numeric(record, 41, 1);
  if (!(width > 0 && height > 0)) throw new Error("VIEWPORTの幅・高さが不正です。");
  const flags = numeric(record, 90, 0);
  return {
    id: `e_import_${index + 1}_${crypto.randomUUID().slice(0, 8)}`,
    type: "viewport",
    layerId,
    center: point(record, 10), width, height,
    status: numeric(record, 68, 0),
    viewportId: numeric(record, 69, 0),
    viewCenter: point(record, 12),
    ...(values(record, 13).length ? { snapBase: point(record, 13) } : {}),
    ...(values(record, 14).length ? { snapSpacing: point(record, 14) } : {}),
    ...(values(record, 15).length ? { gridSpacing: point(record, 15) } : {}),
    viewDirection: { x: numeric(record, 16), y: numeric(record, 26), z: numeric(record, 36, 1) },
    viewTarget: { x: numeric(record, 17), y: numeric(record, 27), z: numeric(record, 37) },
    lensLength: numeric(record, 42, 50),
    frontClip: numeric(record, 43), rearClip: numeric(record, 44),
    viewHeight: numeric(record, 45, height),
    snapAngle: numeric(record, 50), twistAngle: numeric(record, 51),
    flags, locked: Boolean(flags & 16384),
    frozenLayerHandles: values(record, 331),
    style: { strokeWidth: 1, lineDash: [8, 5], fill: "transparent" },
    meta: { createdBy: "import", createdAt: new Date().toISOString() },
    ...metadata(record)
  };
}

export function parseNativeDxfEntity(record, layerId, index = 0, dimensionStyles = []) {
  if (record.type === "DIMENSION") return parseDxfDimension(record, layerId, index, dimensionStyles);
  if (record.type === "HATCH") return parseDxfHatch(record, layerId, index);
  if (record.type === "VIEWPORT") return parseDxfViewport(record, layerId, index);
  return null;
}

export function inspectDxfLayouts(document) {
  const { records } = inspectDxfSourceDocument(document);
  const layoutGroups = (record) => {
    const index = record.groups.findIndex((group) => group.code === 100 && group.value.trim() === "AcDbLayout");
    return index < 0 ? [] : record.groups.slice(index + 1);
  };
  const from = (groups, code, fallback = undefined, last = false) => {
    const matches = groups.filter((group) => group.code === code);
    return (last ? matches.at(-1) : matches[0])?.value ?? fallback;
  };
  const layouts = records.filter((record) => record.section === "OBJECTS" && record.type === "LAYOUT").map((record) => {
    const layout = layoutGroups(record);
    return ({
    dxfRecordId: record.id,
    handle: dxfGroup(record, 5), owner: dxfGroup(record, 330),
    name: decode(from(layout, 1, "")), flags: number(from(layout, 70, 0)), tabOrder: number(from(layout, 71, 0)),
    paperName: decode(dxfGroup(record, 4, "")), plotConfiguration: decode(dxfGroup(record, 2, "")),
    paperWidth: numeric(record, 44), paperHeight: numeric(record, 45),
    blockRecordHandle: from(layout, 330, undefined, true), viewportHandle: from(layout, 331)
  }); });
  return layouts;
}

export function inspectDxfDimensionStyles(document) {
  const { records } = inspectDxfSourceDocument(document);
  return records.filter((record) => record.section === "TABLES" && record.type === "DIMSTYLE").map((record, index) => ({
    id: `dim-dxf-${index + 1}`,
    dxfRecordId: record.id,
    name: decode(dxfGroup(record, 2, "STANDARD")),
    scale: numeric(record, 40, 1),
    arrowSize: numeric(record, 41, 120),
    extensionOffset: numeric(record, 42, 0),
    extensionBeyond: numeric(record, 44, 0),
    textSize: numeric(record, 140, 180),
    measurementScale: numeric(record, 144, 1),
    textGap: numeric(record, 147, 0),
    precision: numeric(record, 271, 0),
    tolerancePrecision: numeric(record, 272, 0),
    tolerance: numeric(record, 71, 0) === 1,
    limits: numeric(record, 72, 0) === 1,
    upperTolerance: numeric(record, 47, 0),
    lowerTolerance: numeric(record, 48, 0),
    rawGroups: record.groups.filter((group) => ![0, 5, 105, 330, 100].includes(group.code)).map((group) => ({ code: group.code, value: group.value }))
  }));
}
