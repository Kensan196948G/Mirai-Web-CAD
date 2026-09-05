import { transformEntity } from "./cad-advanced.js";
import { entityBounds } from "./cad-core.js";

export function blockReference(layerId, definitionId, insertion, options = {}) {
  return {
    id: options.id ?? `e_block_${crypto.randomUUID()}`, type: "block", layerId, definitionId,
    insertion: { x: insertion.x, y: insertion.y }, rotation: options.rotation ?? 0, scale: options.scale ?? 1, scaleZ: options.scaleZ ?? options.scale ?? 1,
    attributeReferences: structuredClone(options.attributeReferences ?? []), children: [],
    style: { strokeWidth: 2, lineDash: [], fill: "transparent" }
  };
}

export function blockAttributeText(attribute) {
  return { id: attribute.id, type: "text", layerId: attribute.layerId, at: attribute.at,
    value: attribute.value, size: attribute.size, rotation: attribute.rotation ?? 0,
    style: { strokeWidth: 1, lineDash: [], fill: "transparent" } };
}

// Children are a derived rendering cache. Definitions and ordered attributes are
// authoritative; callers cannot edit the cache to change a shared definition.
export function resolveBlocks(drawing) {
  const definitions = drawing.blockDefinitions ?? [];
  if (!Array.isArray(definitions) || definitions.length > 1000) throw new Error("BLOCK定義は1000件までです。");
  const byId = new Map(), names = new Set();
  const layers = new Map(drawing.layers.map((layer) => [layer.id, layer]));
  let definitionCount = 0, expandedCount = 0;
  const checkPoint = (p) => {
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) throw new Error("BLOCK座標が不正です。");
  };
  const checkAttribute = (attribute) => {
    checkPoint(attribute.at);
    if (!layers.has(attribute.layerId) || typeof attribute.tag !== "string" || typeof attribute.value !== "string" ||
        !attribute.tag || /[\r\n]/.test(attribute.tag + attribute.value + (attribute.prompt ?? "")) ||
        !Number.isFinite(attribute.size) || attribute.size <= 0 || !Number.isFinite(attribute.rotation ?? 0) ||
        !Number.isInteger(attribute.flags) || attribute.flags < 0 || attribute.flags > 15) throw new Error("BLOCK属性が不正です。");
  };
  for (const definition of definitions) {
    if (!definition || typeof definition.id !== "string" || !definition.id || byId.has(definition.id) ||
        typeof definition.name !== "string" || !definition.name || /[\r\n]/.test(definition.name) || definition.name.length > 255 ||
        names.has(definition.name.toUpperCase()) || !Array.isArray(definition.entities) || !Array.isArray(definition.attributeDefinitions)) {
      throw new Error("BLOCK定義・名称が不正または重複しています。");
    }
    checkPoint(definition.basePoint);
    definition.attributeDefinitions.forEach(checkAttribute);
    definitionCount += definition.entities.length + definition.attributeDefinitions.length;
    if (definitionCount > 10000) throw new Error("BLOCK定義内の図形数が上限を超えています。");
    names.add(definition.name.toUpperCase());
    byId.set(definition.id, definition);
  }
  function resolve(reference, path = []) {
    if (!reference.definitionId) return;
    const definition = byId.get(reference.definitionId);
    if (!definition) throw new Error(`BLOCK定義が見つかりません: ${reference.definitionId}`);
    if (path.includes(definition.id) || path.length >= 32) throw new Error("BLOCK循環参照または入れ子上限超過です。");
    checkPoint(reference.insertion);
    if (!layers.has(reference.layerId) || !Number.isFinite(reference.rotation) || !Number.isFinite(reference.scale) || reference.scale <= 0 || !Number.isFinite(reference.scaleZ) || reference.scaleZ <= 0 ||
        !Array.isArray(reference.attributeReferences)) throw new Error("BLOCK参照の尺度・属性が不正です。");
    reference.attributeReferences.forEach(checkAttribute);
    reference.name = definition.name;
    const inherit = (entity) => layers.get(entity.layerId)?.name === "0" ? reference.layerId : entity.layerId;
    const children = [];
    for (const entity of definition.entities) {
      if (!layers.has(entity.layerId) || !["line", "circle", "arc", "polyline", "text", "block"].includes(entity.type) ||
          (entity.type === "block" && !entity.definitionId)) throw new Error("BLOCK定義内の図形・レイヤーが未対応です。");
      const child = structuredClone(entity);
      child.layerId = inherit(child);
      if (child.type === "block") resolve(child, [...path, definition.id]);
      if (["line", "polyline"].includes(child.type)) {
        if (!Array.isArray(child.points) || child.points.length < 2 || (child.type === "line" && child.points.length !== 2)) throw new Error("BLOCK頂点数が不正です。");
        child.points.forEach(checkPoint);
      }
      if (["circle", "arc"].includes(child.type)) {
        checkPoint(child.center);
        if (!Number.isFinite(child.radius) || child.radius <= 0) throw new Error("BLOCK半径が不正です。");
        if (child.type === "arc" && (![child.startAngle, child.endAngle].every(Number.isFinite) || (child.endAngle - child.startAngle) % 360 === 0)) throw new Error("BLOCK円弧角度が不正です。");
      }
      if (child.type === "text") {
        checkPoint(child.at);
        if (typeof child.value !== "string" || !Number.isFinite(child.size) || child.size <= 0 || !Number.isFinite(child.rotation ?? 0)) throw new Error("BLOCK文字が不正です。");
      }
      const bounds = entityBounds(child);
      if (!bounds || !Object.values(bounds).every(Number.isFinite)) throw new Error("BLOCK定義内の形状が不正です。");
      children.push(transformEntity(child, { dx: -definition.basePoint.x, dy: -definition.basePoint.y }));
    }
    for (const attribute of definition.attributeDefinitions.filter((item) => (item.flags & 2) && !(item.flags & 1) && !reference.attributeReferences.some((referenceAttribute) => referenceAttribute.tag === item.tag))) {
      children.push(transformEntity({ ...blockAttributeText(attribute), layerId: inherit(attribute) }, { dx: -definition.basePoint.x, dy: -definition.basePoint.y }));
    }
    for (const attribute of reference.attributeReferences.filter((item) => !(item.flags & 1))) {
      children.push({ ...blockAttributeText(attribute), layerId: inherit(attribute) });
    }
    expandedCount += children.length;
    if (expandedCount > 20000) throw new Error("BLOCK展開図形数が20000件を超えています。");
    reference.children = children;
    const bounds = entityBounds(reference);
    if (bounds && !Object.values(bounds).every(Number.isFinite)) throw new Error("BLOCK変換後の座標が上限を超えています。");
  }
  // Validate unreferenced definitions as well, including cycles.
  for (const definition of definitions) resolve(blockReference(drawing.layers[0].id, definition.id, { x: 0, y: 0 }));
  for (const entity of drawing.entities) if (entity.type === "block") resolve(entity);
}
