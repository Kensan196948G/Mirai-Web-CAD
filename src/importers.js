import DxfParserPackage from "dxf-parser";
import { circle, line, polyline, rect, text } from "./cad-core.js";

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
  for (const [index, entity] of sourceEntities.entries()) {
    try {
      commands.push({ op: "add", entity: normalizeJsonEntity(entity, layers.resolve(entity?.layerId), index) });
    } catch (error) {
      warnings.push(`entity ${index + 1}: ${error instanceof Error ? error.message : String(error)}`);
    }
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
    return polyline(layerId, arcPoints(entity), options);
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

function arcPoints(entity) {
  const center = coordinate(entity.center);
  const radius = positive(entity.radius);
  let start = finite(entity.startAngle, "startAngle");
  let end = finite(entity.endAngle, "endAngle");
  if (Math.abs(start) > Math.PI * 2 || Math.abs(end) > Math.PI * 2) {
    start = (start * Math.PI) / 180;
    end = (end * Math.PI) / 180;
  }
  while (end <= start) end += Math.PI * 2;
  const count = Math.max(8, Math.min(64, Math.ceil(((end - start) / (Math.PI * 2)) * 48)));
  return Array.from({ length: count + 1 }, (_, index) => {
    const angle = start + ((end - start) * index) / count;
    return { x: center.x + Math.cos(angle) * radius, y: center.y + Math.sin(angle) * radius };
  });
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
