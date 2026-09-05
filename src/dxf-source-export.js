import { createDrawing, applyTransaction } from "./cad-core.js";
import { parseCadImport } from "./importers.js";
import { dxfGroup, inspectDxfBlocks, inspectDxfSourceDocument, rewriteDxfSourceDocument } from "./dxf-source-document.js";
import { blockAttributeText } from "./cad-block.js";
import { affineText, blockAffine } from "./cad-affine.js";

// Reparse the archive instead of trusting a persisted/user-supplied baseline.
// IDs and derived caches are not DXF semantics; every other model field counts.
function semantic(value, drawing, omit = new Set()) {
  if (Array.isArray(value)) return value.map((item) => semantic(item, drawing, omit));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().filter((key) => !["id", "meta", "children", "dxfRecordId"].includes(key) && !omit.has(key)).map((key) => [key,
    key === "layerId" ? drawing.layers.find((layer) => layer.id === value[key])?.name :
    key === "definitionId" ? drawing.blockDefinitions.find((definition) => definition.id === value[key])?.name : semantic(value[key], drawing, omit)]));
}

export function exportDxfFromSource(drawing, encodeEntity, encodeDefinition) {
  if (drawing.dxfSources?.length !== 1) return null;
  const document = drawing.dxfSources[0];
  const empty = createDrawing();
  const parsed = parseCadImport({ filename: "source.dxf", content: document.source, drawing: empty, currentLayerId: empty.layers[0].id });
  const imported = applyTransaction(empty, { commands: parsed.commands });
  if (!imported.ok) throw new Error(imported.error);
  const original = imported.drawing;
  const equal = (a, b, omit) => JSON.stringify(semantic(a, drawing, omit)) === JSON.stringify(semantic(b, original, omit));
  if (drawing.unit !== original.unit || !equal(drawing.layout, original.layout) || !equal(drawing.layers, original.layers)) return null;
  const view = inspectDxfBlocks(document), inspected = inspectDxfSourceDocument(document);
  const sourceReferences = new Map(view.references.map((reference) => [reference.recordId, reference]));
  const used = new Set(), patches = [], removeRecordIds = [], insertions = [];
  const add = (recordId, code, value, occurrence = 0) => patches.push({ recordId, code, value, occurrence });
  const encode = (value) => String(value).replace(/[^\x00-\x7f]/g, (c) => `\\U+${c.charCodeAt(0).toString(16).padStart(4, "0").toUpperCase()}`);
  const eol = document.source.match(/\r\n|\n|\r/)?.[0] ?? "\n";
  const sourceText = (value) => encode(String(value).replace(/[\r\n]/g, " "));
  const patchText = (entity, before, recordId, prompt = false) => {
    const omitted = new Set(["at", "value", "prompt", "size", "rotation", "widthFactor", "oblique", "generationFlags"]);
    if (!equal(entity, before, omitted)) return false;
    for (const [code, value, previous] of [[10, entity.at.x, before.at.x], [20, entity.at.y, before.at.y], [40, entity.size, before.size], [50, entity.rotation ?? 0, before.rotation ?? 0],
      [41, entity.widthFactor ?? 1, before.widthFactor ?? 1], [51, entity.oblique ?? 0, before.oblique ?? 0], [71, entity.generationFlags ?? 0, before.generationFlags ?? 0],
      [1, encode(entity.value), encode(before.value)], ...(prompt ? [[3, encode(entity.prompt ?? ""), encode(before.prompt ?? "")]] : [])]) if (value !== previous) add(recordId, code, value);
    return true;
  };
  const patchBlock = (entity, before) => {
    const currentDefinition = drawing.blockDefinitions.find((definition) => definition.id === entity.definitionId);
    const originalDefinition = original.blockDefinitions.find((definition) => definition.id === before.definitionId);
    if (!currentDefinition || currentDefinition.dxfRecordId !== originalDefinition?.dxfRecordId ||
        !equal(entity, before, new Set(["name", "definitionId", "insertion", "rotation", "scale", "axisScale", "scaleZ", "attributeReferences"]))) return false;
    const attributes = entity.attributeReferences;
    if (attributes.length !== before.attributeReferences.length) return false;
    const raw = sourceReferences.get(entity.dxfRecordId);
    if (!raw || raw.attributes.length !== attributes.length) return false;
    for (const [code, value, previous] of [[10, entity.insertion.x, before.insertion.x], [20, entity.insertion.y, before.insertion.y],
      [41, entity.scale*(entity.axisScale?.x ?? 1), before.scale*(before.axisScale?.x ?? 1)], [42, entity.scale*(entity.axisScale?.y ?? 1), before.scale*(before.axisScale?.y ?? 1)], [43, entity.scaleZ, before.scaleZ], [50, entity.rotation, before.rotation]]) if (value !== previous) add(raw.recordId, code, value);
    for (const [index, attribute] of attributes.entries()) {
      const old = before.attributeReferences[index];
      if (!equal(attribute, old, new Set(["at", "value", "size", "rotation", "widthFactor", "oblique", "generationFlags"]))) return false;
      const recordId = raw.attributes[index].recordId;
      if (attribute.value !== old.value) add(recordId, 1, encode(attribute.value));
      const world = (a, reference) => affineText(blockAttributeText(a), blockAffine(reference));
      const a = world(attribute, entity), b = world(old, before);
      for (const [code, value, previous] of [[10, a.at.x, b.at.x], [20, a.at.y, b.at.y], [40, a.size, b.size], [50, a.rotation, b.rotation], [41, a.widthFactor, b.widthFactor], [51, a.oblique, b.oblique], [71, a.generationFlags, b.generationFlags]]) if (value !== previous) add(recordId, code, value);
    }
    return true;
  };
  const patchPrimitive = (entity, before) => {
    const recordId = entity.dxfRecordId;
    const geometry = {
      line: ["points"], circle: ["center", "radius"], arc: ["center", "radius", "startAngle", "endAngle"],
      polyline: ["points", "closed"], text: ["at", "value", "size", "rotation", "widthFactor", "oblique", "generationFlags"]
    }[entity.type];
    if (!geometry || entity.type !== before.type || !equal(entity, before, new Set(geometry))) return false;
    if (entity.type === "text") return patchText(entity, before, recordId);
    const pointCodes = entity.type === "line" ? [[10, 20], [11, 21]] : entity.type === "polyline" ? entity.points.map((_point, index) => [10, 20, index]) : [[10, 20]];
    if ((entity.points?.length ?? 1) !== (before.points?.length ?? 1)) return false;
    const points = entity.points ?? [entity.center], oldPoints = before.points ?? [before.center];
    pointCodes.forEach(([x, y, occurrence = 0], index) => { if (points[index].x !== oldPoints[index].x) add(recordId, x, points[index].x, occurrence); if (points[index].y !== oldPoints[index].y) add(recordId, y, points[index].y, occurrence); });
    if (entity.radius !== undefined && entity.radius !== before.radius) add(recordId, 40, entity.radius);
    if (entity.startAngle !== undefined && entity.startAngle !== before.startAngle) add(recordId, 50, entity.startAngle);
    if (entity.endAngle !== undefined && entity.endAngle !== before.endAngle) add(recordId, 51, entity.endAngle);
    if (entity.closed !== undefined && entity.closed !== before.closed) add(recordId, 70, entity.closed ? 1 : 0);
    return true;
  };
  const patchCollection = (current, baseline, section, beforeRecordId = null) => {
    const byRecord = new Map(baseline.map((entity) => [entity.dxfRecordId, entity]));
    const currentExisting = current.map((entity) => entity.dxfRecordId).filter(Boolean);
    const currentSet = new Set(currentExisting);
    if (current.some((entity, index) => !entity.dxfRecordId && current.slice(index + 1).some((later) => later.dxfRecordId)) ||
        JSON.stringify(currentExisting) !== JSON.stringify(baseline.map((entity) => entity.dxfRecordId).filter((recordId) => currentSet.has(recordId)))) return false;
    for (const entity of current) {
      if (!entity.dxfRecordId) {
        insertions.push({ section, beforeRecordId, content: encodeEntity(entity, drawing).replaceAll("\n", eol) });
        continue;
      }
      const before = byRecord.get(entity.dxfRecordId);
      if (!before || used.has(entity.dxfRecordId)) return false;
      used.add(entity.dxfRecordId);
      if (!equal(entity, before) && !(entity.definitionId ? patchBlock(entity, before) : patchPrimitive(entity, before))) return false;
    }
    for (const entity of baseline) if (!used.has(entity.dxfRecordId)) {
      removeRecordIds.push(entity.dxfRecordId);
      const reference = sourceReferences.get(entity.dxfRecordId);
      if (reference?.followsAttributes) {
        removeRecordIds.push(...reference.attributes.map((attribute) => attribute.recordId));
        const index = inspected.records.findIndex((record) => record.id === entity.dxfRecordId);
        const seqend = inspected.records.slice(index + 1).find((record) => record.type === "SEQEND");
        if (seqend) removeRecordIds.push(seqend.id);
      }
    }
    return true;
  };
  if (!patchCollection(drawing.entities, original.entities, "ENTITIES")) return null;
  const originalDefinitions = new Map(original.blockDefinitions.map((definition) => [definition.dxfRecordId, definition]));
  const currentExisting = drawing.blockDefinitions.map((definition) => definition.dxfRecordId).filter(Boolean);
  const currentDefinitionIds = new Set(currentExisting);
  if (drawing.blockDefinitions.some((definition, index) => !definition.dxfRecordId && drawing.blockDefinitions.slice(index + 1).some((later) => later.dxfRecordId)) ||
      JSON.stringify(currentExisting) !== JSON.stringify(original.blockDefinitions.map((definition) => definition.dxfRecordId).filter((id) => currentDefinitionIds.has(id)))) return null;
  const blockTableIndex = inspected.records.findIndex((record) => record.type === "TABLE" && dxfGroup(record, 2, "").toUpperCase() === "BLOCK_RECORD");
  const blockTable = inspected.records[blockTableIndex];
  const blockTableEnd = inspected.records.slice(blockTableIndex + 1).find((record) => record.type === "ENDTAB");
  if ((drawing.blockDefinitions.some((definition) => !definition.dxfRecordId) || original.blockDefinitions.some((definition) => !currentDefinitionIds.has(definition.dxfRecordId))) && (!blockTable || !blockTableEnd || !dxfGroup(blockTable, 5))) return null;
  const usedHandles = inspected.records.map((record) => dxfGroup(record, 5)).filter(Boolean).map((handle) => Number.parseInt(handle, 16)).filter(Number.isFinite);
  let nextHandle = Math.max(0x100, ...usedHandles) + 1;
  let tableDelta = 0;
  for (const definition of drawing.blockDefinitions) {
    if (!definition.dxfRecordId) {
      const owner = (nextHandle++).toString(16).toUpperCase();
      const record = ["0", "BLOCK_RECORD", "5", owner, "330", dxfGroup(blockTable, 5), "100", "AcDbSymbolTableRecord", "100", "AcDbBlockTableRecord", "2", sourceText(definition.name), "70", "0"].join(eol) + eol;
      insertions.push({ section: "TABLES", beforeRecordId: blockTableEnd.id, content: record });
      insertions.push({ section: "BLOCKS", content: encodeDefinition(definition, drawing, owner).replaceAll("\n", eol) });
      tableDelta++;
      continue;
    }
    const before = originalDefinitions.get(definition.dxfRecordId), sourceDefinition = view.definitions.find((item) => item.recordId === definition.dxfRecordId);
    if (!before || !sourceDefinition) return null;
    const start = inspected.records.findIndex((record) => record.id === sourceDefinition.recordId);
    const end = inspected.records.slice(start + 1).find((record) => record.type === "ENDBLK");
    if (!end || !patchCollection(definition.entities, before.entities, "BLOCKS", end.id)) return null;
    if (definition.name !== before.name) {
      const blockRecord = inspected.records.find((record) => record.type === "BLOCK_RECORD" && dxfGroup(record, 5) === sourceDefinition.owner);
      if (!blockRecord) return null;
      add(blockRecord.id, 2, sourceText(definition.name)); add(sourceDefinition.recordId, 2, sourceText(definition.name)); add(sourceDefinition.recordId, 3, sourceText(definition.name));
      for (const reference of view.references.filter((item) => item.definitionRecordId === sourceDefinition.recordId)) add(reference.recordId, 2, sourceText(definition.name));
    }
    if (definition.basePoint.x !== before.basePoint.x) add(sourceDefinition.recordId, 10, definition.basePoint.x);
    if (definition.basePoint.y !== before.basePoint.y) add(sourceDefinition.recordId, 20, definition.basePoint.y);
    if (definition.attributeDefinitions.length !== before.attributeDefinitions.length) return null;
    for (const [attributeIndex, attribute] of definition.attributeDefinitions.entries()) if (!equal(attribute, before.attributeDefinitions[attributeIndex]) &&
      !patchText(attribute, before.attributeDefinitions[attributeIndex], attribute.dxfRecordId, true)) return null;
  }
  for (const definition of original.blockDefinitions.filter((item) => !currentDefinitionIds.has(item.dxfRecordId))) {
    const sourceDefinition = view.definitions.find((item) => item.recordId === definition.dxfRecordId);
    const start = inspected.records.findIndex((record) => record.id === sourceDefinition?.recordId);
    const endOffset = inspected.records.slice(start + 1).findIndex((record) => record.type === "ENDBLK");
    if (!sourceDefinition || start < 0 || endOffset < 0) return null;
    const end = start + 1 + endOffset;
    removeRecordIds.push(...inspected.records.slice(start, end + 1).map((record) => record.id));
    const blockRecord = inspected.records.find((record) => record.type === "BLOCK_RECORD" && dxfGroup(record, 5) === sourceDefinition.owner);
    if (!blockRecord) return null;
    removeRecordIds.push(blockRecord.id);
    tableDelta--;
  }
  if (tableDelta) add(blockTable.id, 70, Number(dxfGroup(blockTable, 70, 0)) + tableDelta);
  const removed = new Set(removeRecordIds);
  const removedHandles = new Set(inspected.records.filter((record) => removed.has(record.id)).map((record) => dxfGroup(record, 5)).filter(Boolean));
  const handleReference = (code) => (code >= 320 && code <= 369) || (code >= 390 && code <= 399) || code === 480 || code === 481 || code === 1005;
  if (inspected.records.some((record) => !removed.has(record.id) && record.groups.some((group) => handleReference(group.code) && removedHandles.has(group.value.trim())))) return null;
  return { content: rewriteDxfSourceDocument(document, { patches, removeRecordIds, insertions }), exported: drawing.entities.length, skipped: [],
    preservation: { mode: "source-patch", changedGroups: patches.length, removedRecords: removeRecordIds.length, insertedRecords: insertions.length },
    warnings: [] };
}
