import { createDrawing, applyTransaction } from "./cad-core.js";
import { parseCadImport } from "./importers.js";
import { inspectDxfBlocks, patchDxfSourceValues } from "./dxf-source-document.js";
import { blockAttributeText } from "./cad-block.js";
import { transformEntity } from "./cad-advanced.js";

// Reparse the archive instead of trusting a persisted/user-supplied baseline.
// IDs and derived caches are not DXF semantics; every other model field counts.
function semantic(value, drawing, omit = new Set()) {
  if (Array.isArray(value)) return value.map((item) => semantic(item, drawing, omit));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().filter((key) => !["id", "meta", "children"].includes(key) && !omit.has(key)).map((key) => [key,
    key === "layerId" ? drawing.layers.find((layer) => layer.id === value[key])?.name :
    key === "definitionId" ? drawing.blockDefinitions.find((definition) => definition.id === value[key])?.name : semantic(value[key], drawing, omit)]));
}

export function exportDxfFromSource(drawing) {
  if (drawing.dxfSources?.length !== 1) return null;
  const document = drawing.dxfSources[0];
  const empty = createDrawing();
  const parsed = parseCadImport({ filename: "source.dxf", content: document.source, drawing: empty, currentLayerId: empty.layers[0].id });
  const imported = applyTransaction(empty, { commands: parsed.commands });
  if (!imported.ok) throw new Error(imported.error);
  const original = imported.drawing;
  const equal = (a, b, omit) => JSON.stringify(semantic(a, drawing, omit)) === JSON.stringify(semantic(b, original, omit));
  if (drawing.unit !== original.unit || !equal(drawing.layout, original.layout) || !equal(drawing.layers, original.layers) ||
      !equal(drawing.blockDefinitions, original.blockDefinitions) || drawing.entities.length !== original.entities.length ||
      drawing.entities.some((entity, index) => entity.dxfRecordId !== original.entities[index].dxfRecordId)) return null;
  const originals = new Map(original.entities.map((entity) => [entity.dxfRecordId, entity]));
  const sourceReferences = new Map(inspectDxfBlocks(document).references.map((reference) => [reference.recordId, reference]));
  const used = new Set(), patches = [];
  const add = (recordId, code, value) => patches.push({ recordId, code, value });
  const encode = (value) => String(value).replace(/[^\x00-\x7f]/g, (c) => `\\U+${c.charCodeAt(0).toString(16).padStart(4, "0").toUpperCase()}`);
  for (const entity of drawing.entities) {
    const before = originals.get(entity.dxfRecordId);
    if (!before || used.has(entity.dxfRecordId)) return null;
    used.add(entity.dxfRecordId);
    if (equal(entity, before)) continue;
    if (!entity.definitionId || !equal(entity, before, new Set(["insertion", "rotation", "scale", "scaleZ", "attributeReferences"]))) return null;
    const attributes = entity.attributeReferences;
    if (attributes.length !== before.attributeReferences.length) return null;
    const raw = sourceReferences.get(entity.dxfRecordId);
    if (!raw || raw.attributes.length !== attributes.length) return null;
    for (const [code, value, previous] of [[10, entity.insertion.x, before.insertion.x], [20, entity.insertion.y, before.insertion.y],
      [41, entity.scale, before.scale], [42, entity.scale, before.scale], [43, entity.scaleZ, before.scaleZ], [50, entity.rotation, before.rotation]]) {
      if (value !== previous) add(raw.recordId, code, value);
    }
    for (const [index, attribute] of attributes.entries()) {
      const old = before.attributeReferences[index];
      if (!equal(attribute, old, new Set(["value"]))) return null;
      const recordId = raw.attributes[index].recordId;
      if (attribute.value !== old.value) add(recordId, 1, encode(attribute.value));
      const world = (a, reference) => transformEntity(blockAttributeText(a), { dx: reference.insertion.x, dy: reference.insertion.y, angle: reference.rotation, scale: reference.scale });
      const a = world(attribute, entity), b = world(old, before);
      for (const [code, value, previous] of [[10, a.at.x, b.at.x], [20, a.at.y, b.at.y], [40, a.size, b.size], [50, a.rotation, b.rotation]]) {
        if (value !== previous) add(recordId, code, value);
      }
    }
  }
  return { content: patchDxfSourceValues(document, patches), exported: drawing.entities.length, skipped: [],
    preservation: { mode: "source-patch", changedGroups: patches.length },
    warnings: ["原本保持DXF: TABLES・OBJECTS・未使用BLOCK等を保持しました。未対応情報の表示・編集・連想更新を保証するものではありません。"] };
}
