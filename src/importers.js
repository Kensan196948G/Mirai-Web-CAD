import DxfParserPackage from "dxf-parser";
import { arc, circle, ellipse, line, polyline, rect, spline, text } from "./cad-core.js";
import { blockEntity, dimensionEntity, hatchEntity } from "./cad-advanced.js";

const MAX_IMPORT_BYTES = 10 * 1024 * 1024;
const MAX_IMPORT_ENTITIES = 10_000;
const IMPORT_COLORS = ["#1574b8", "#1e946f", "#a26a1d", "#d14f4f", "#6f56a5", "#337f8f"];
const DxfParser = /** @type {any} */ (DxfParserPackage);

export function parseCadImport({ filename, content, drawing, currentLayerId }) {
  if (new TextEncoder().encode(content).byteLength > MAX_IMPORT_BYTES) {
    throw new Error("Importファイルは10MB以下にしてください。");
  }
  const extension = filename.toLowerCase().split(".").pop();
  if (extension === "json") return parseJsonImport(content, drawing, currentLayerId);
  if (extension === "dxf") return parseDxfImport(content, drawing, currentLayerId);
  throw new Error("対応形式はJSONまたはASCII DXFです。");
}

function parseJsonImport(content, drawing, currentLayerId) {
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error("JSONを解析できませんでした。");
  }
  const sourceEntities = Array.isArray(parsed) ? parsed : parsed?.entities;
  if (!Array.isArray(sourceEntities)) throw new Error("JSONにentities配列がありません。");
  assertEntityLimit(sourceEntities.length);
  const sourceLayers = Array.isArray(parsed?.layers) ? parsed.layers : [];
  const layers = createLayerMapping(sourceLayers, drawing, currentLayerId);
  const commands = [...layers.commands];
  const warnings = [];
  const importedIds = new Map();
  for (const [index, entity] of sourceEntities.entries()) {
    try {
      const normalized = normalizeJsonEntity(entity, layers.resolve(entity?.layerId), index);
      if (entity.id) importedIds.set(entity.id, normalized.id);
      commands.push({ op: "add", entity: normalized });
    } catch (error) {
      warnings.push(`entity ${index + 1}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  for (const command of commands) {
    if (command.op !== "add" || command.entity.type !== "dimension" || !command.entity.references) continue;
    command.entity.references = command.entity.references.map((ref) => {
      const id = importedIds.get(ref.entityId);
      if (!id) warnings.push(`寸法参照先を復元できません: ${ref.entityId}`);
      return { ...ref, entityId: id ?? `missing_${crypto.randomUUID()}` };
    });
  }
  const names = new Set((drawing.selectionSets ?? []).map((set) => set.name));
  for (const set of Array.isArray(parsed?.selectionSets) ? parsed.selectionSets : []) {
    if (names.size >= 100 || typeof set?.name !== "string" || !set.name.trim() || set.name.length > 80 || !Array.isArray(set.entityIds)) {
      warnings.push("選択セットを取り込めませんでした。");
      continue;
    }
    const entityIds = [...new Set(set.entityIds.map((id) => importedIds.get(id)).filter(Boolean))];
    if (!entityIds.length) { warnings.push(`空の選択セット: ${set.name}`); continue; }
    let name = set.name, suffix = 1;
    while (names.has(name)) name = `${set.name.slice(0, 70)} (${suffix++})`;
    names.add(name);
    commands.push({ op: "save_selection", name, entityIds });
  }
  return importResult(commands, warnings, sourceEntities.length);
}

function parseDxfImport(content, drawing, currentLayerId) {
  let parsed;
  try {
    parsed = new DxfParser().parseSync(content);
  } catch {
    throw new Error("DXFを解析できませんでした。ASCII DXFか確認してください。");
  }
  const sourceEntities = parsed?.entities ?? [];
  assertEntityLimit(sourceEntities.length);
  const layerNames = [...new Set(sourceEntities.map((entity) => entity.layer).filter(Boolean))];
  const layers = createLayerMapping(
    layerNames.map((name) => ({ id: name, name })),
    drawing,
    currentLayerId
  );
  const commands = [...layers.commands];
  const warnings = [];
  for (const [index, entity] of sourceEntities.entries()) {
    try {
      const normalized = normalizeDxfEntity(entity, layers.resolve(entity.layer), index);
      if (normalized) commands.push({ op: "add", entity: normalized });
      else warnings.push(`${entity.type ?? "UNKNOWN"}は未対応のためスキップしました。`);
    } catch (error) {
      warnings.push(`${entity.type ?? "UNKNOWN"} ${index + 1}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return importResult(commands, warnings, sourceEntities.length);
}

function createLayerMapping(sourceLayers, drawing, fallbackId) {
  const existingIds = new Set(drawing.layers.map((layer) => layer.id));
  const existingByName = new Map(drawing.layers.map((layer) => [layer.name.toLowerCase(), layer.id]));
  const mapping = new Map();
  const commands = [];
  for (const [index, source] of sourceLayers.entries()) {
    const sourceId = String(source?.id ?? source?.name ?? `layer-${index}`);
    const name = String(source?.name ?? sourceId).slice(0, 80);
    const existing = existingByName.get(name.toLowerCase());
    if (existing) {
      mapping.set(sourceId, existing);
      continue;
    }
    let id = `layer-import-${slug(name) || index + 1}`;
    while (existingIds.has(id)) id = `${id}-${index + 1}`;
    existingIds.add(id);
    existingByName.set(name.toLowerCase(), id);
    mapping.set(sourceId, id);
    commands.push({
      op: "add_layer",
      layer: {
        id,
        name,
        color: validColor(source?.color) ?? IMPORT_COLORS[index % IMPORT_COLORS.length],
        locked: false,
        visible: true,
        printable: true
      }
    });
  }
  return { commands, resolve: (sourceId) => mapping.get(String(sourceId)) ?? fallbackId };
}

function normalizeJsonEntity(entity, layerId, index) {
  if (!entity || typeof entity !== "object") throw new Error("図形データが不正です。");
  const options = entityOptions(entity, index);
  if (entity.type === "line") return line(layerId, pair(entity.points, 2), pair(entity.points, 2, 1), options);
  if (entity.type === "rect") {
    return rect(layerId, coordinate(entity.origin), finite(entity.width, "width"), finite(entity.height, "height"), options);
  }
  if (entity.type === "circle") {
    const radius = finite(entity.radius, "radius");
    if (radius <= 0) throw new Error("radiusは0より大きい値が必要です。");
    return circle(layerId, coordinate(entity.center), radius, options);
  }
  if (entity.type === "arc") {
    const radius = finite(entity.radius, "radius");
    if (radius <= 0) throw new Error("radiusは0より大きい値が必要です。");
    const startAngle = finite(entity.startAngle, "startAngle");
    const endAngle = finite(entity.endAngle, "endAngle");
    if (normalizedSweep(startAngle, endAngle) <= 1e-9) throw new Error("startAngleとendAngleは異なる値が必要です。");
    return arc(layerId, coordinate(entity.center), radius, startAngle, endAngle, options);
  }
  if (entity.type === "ellipse") {
    const radiusX = positive(entity.radiusX);
    const radiusY = positive(entity.radiusY);
    return ellipse(layerId, coordinate(entity.center), radiusX, radiusY, finite(entity.rotation ?? 0, "rotation"), {
      ...options,
      startParameter: finite(entity.startParameter ?? 0, "startParameter"),
      endParameter: finite(entity.endParameter ?? Math.PI * 2, "endParameter")
    });
  }
  if (entity.type === "spline") {
    if (!Array.isArray(entity.controlPoints) || entity.controlPoints.length < 2) throw new Error("splineには2点以上の制御点が必要です。");
    return spline(layerId, entity.controlPoints.map(coordinate), {
      ...options,
      degree: Number(entity.degree ?? 3),
      knots: entity.knots,
      closed: Boolean(entity.closed)
    });
  }
  if (entity.type === "polyline") {
    if (!Array.isArray(entity.points) || entity.points.length < 2) throw new Error("polylineには2点以上必要です。");
    return polyline(layerId, entity.points.map(coordinate), { ...options, closed: Boolean(entity.closed) });
  }
  if (entity.type === "text") {
    return text(layerId, coordinate(entity.at), String(entity.value ?? ""), {
      ...options,
      size: positive(entity.size, 180)
    });
  }
  if (entity.type === "dimension") {
    return dimensionEntity(layerId, pair(entity.points, 2), pair(entity.points, 2, 1), {
      ...options, offset: finite(entity.offset ?? 350, "offset"), precision: Number(entity.precision ?? 0), suffix: entity.suffix ?? "",
      dimensionType: entity.dimensionType, prefix: entity.prefix, textSize: entity.textSize,
      arrowSize: entity.arrowSize, measurementScale: entity.measurementScale, references: entity.references
    });
  }
  if (entity.type === "hatch") {
    if (!Array.isArray(entity.points) || entity.points.length < 3) throw new Error("hatchには3点以上必要です。");
    return hatchEntity(layerId, entity.points.map(coordinate), { ...options, pattern: entity.pattern, spacing: entity.spacing, angle: entity.angle });
  }
  if (entity.type === "block") {
    if (!Array.isArray(entity.children) || entity.children.length === 0) throw new Error("blockにchildrenがありません。");
    const children = entity.children.map((child, childIndex) => normalizeJsonEntity(child, layerId, index * 100 + childIndex));
    return blockEntity(layerId, entity.name, coordinate(entity.insertion), children, entity.attributes, {
      ...options, rotation: entity.rotation, scale: entity.scale
    });
  }
  throw new Error(`未対応typeです: ${entity.type}`);
}

function normalizeDxfEntity(entity, layerId, index) {
  const options = { id: importEntityId(index) };
  if (entity.type === "LINE") return line(layerId, coordinate(entity.vertices?.[0]), coordinate(entity.vertices?.[1]), options);
  if (entity.type === "CIRCLE") return circle(layerId, coordinate(entity.center), positive(entity.radius), options);
  if (["LWPOLYLINE", "POLYLINE"].includes(entity.type)) {
    if (!Array.isArray(entity.vertices) || entity.vertices.length < 2) throw new Error("頂点が不足しています。");
    return polyline(layerId, entity.vertices.map(coordinate), { ...options, closed: Boolean(entity.shape) });
  }
  if (entity.type === "ARC") {
    return arc(
      layerId,
      coordinate(entity.center),
      positive(entity.radius),
      radiansToDegrees(entity.startAngle),
      radiansToDegrees(entity.endAngle),
      options
    );
  }
  if (entity.type === "ELLIPSE") {
    const axis = coordinate(entity.majorAxisEndPoint);
    const radiusX = Math.hypot(axis.x, axis.y);
    const ratio = positive(entity.axisRatio);
    if (ratio > 1) throw new Error("楕円の短半径比は1以下である必要があります。");
    return ellipse(layerId, coordinate(entity.center), radiusX, radiusX * ratio, radiansToDegrees(Math.atan2(axis.y, axis.x)), {
      ...options,
      startParameter: finite(entity.startAngle ?? 0, "startParameter"),
      endParameter: finite(entity.endAngle ?? Math.PI * 2, "endParameter")
    });
  }
  if (entity.type === "SPLINE") {
    const controlPoints = entity.controlPoints ?? entity.fitPoints;
    if (!Array.isArray(controlPoints) || controlPoints.length < 2) throw new Error("制御点が不足しています。");
    return spline(layerId, controlPoints.map(coordinate), {
      ...options,
      degree: Number(entity.degreeOfSplineCurve ?? Math.min(3, controlPoints.length - 1)),
      knots: entity.knotValues,
      closed: Boolean(entity.closed)
    });
  }
  if (entity.type === "TEXT") {
    return text(layerId, coordinate(entity.startPoint), String(entity.text ?? ""), {
      ...options,
      size: positive(entity.textHeight, 180)
    });
  }
  if (entity.type === "MTEXT") {
    return text(layerId, coordinate(entity.position), String(entity.text ?? ""), {
      ...options,
      size: positive(entity.height, 180)
    });
  }
  return null;
}

function radiansToDegrees(value) {
  return (finite(value, "angle") * 180) / Math.PI;
}

function normalizedSweep(startAngle, endAngle) {
  return ((endAngle - startAngle) % 360 + 360) % 360;
}

function entityOptions(entity, index) {
  return {
    id: importEntityId(index),
    strokeWidth: positive(entity.style?.strokeWidth, 2),
    lineDash: Array.isArray(entity.style?.lineDash) ? entity.style.lineDash.filter(Number.isFinite).slice(0, 8) : [],
    fill: validColor(entity.style?.fill) ?? "transparent",
    createdBy: "import"
  };
}

function importResult(commands, warnings, sourceCount) {
  const entityCount = commands.filter((command) => command.op === "add").length;
  if (entityCount === 0) throw new Error("Import可能な2D図形がありませんでした。");
  return { commands, warnings: warnings.slice(0, 50), sourceCount, entityCount };
}

function pair(points, minimum, index = 0) {
  if (!Array.isArray(points) || points.length < minimum) throw new Error("pointsが不足しています。");
  return coordinate(points[index]);
}

function coordinate(value) {
  if (!value || typeof value !== "object") throw new Error("座標が不正です。");
  return { x: finite(value.x, "x"), y: finite(value.y, "y") };
}

function finite(value, label) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`${label}が数値ではありません。`);
  return parsed;
}

function positive(value, fallback) {
  const parsed = Number(value);
  if (Number.isFinite(parsed) && parsed > 0) return parsed;
  if (fallback !== undefined) return fallback;
  throw new Error("正の数値が必要です。");
}

function validColor(value) {
  return /^#[0-9a-f]{6}$/i.test(String(value)) ? String(value) : null;
}

function slug(value) {
  return value.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 36);
}

function importEntityId(index) {
  const random = globalThis.crypto?.randomUUID?.().slice(0, 8) ?? Math.random().toString(16).slice(2, 10);
  return `e_import_${index + 1}_${random}`;
}

function assertEntityLimit(count) {
  if (count > MAX_IMPORT_ENTITIES) throw new Error(`Import可能な図形数は${MAX_IMPORT_ENTITIES}件までです。`);
}
