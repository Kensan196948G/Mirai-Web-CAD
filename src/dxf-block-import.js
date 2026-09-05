import { createDxfSourceDocument, inspectDxfSourceDocument, inspectDxfBlocks, dxfGroup } from "./dxf-source-document.js";
import { blockReference } from "./cad-block.js";
import { transformEntity } from "./cad-advanced.js";

export function decodeDxfText(value) {
  return String(value).replace(/\\U\+([0-9a-f]{4})/gi, (_match, code) => String.fromCharCode(parseInt(code, 16)));
}

export function prepareDxfBlocks(content, drawing, createLayers, parsePrimitive) {
  const document = createDxfSourceDocument(content);
  const { records } = inspectDxfSourceDocument(document);
  const view = inspectDxfBlocks(document);
  if (view.diagnostics.length) throw new Error(view.diagnostics.join(" / "));
  const recordsById = new Map(records.map((record) => [record.id, record]));
  const systemBlock = (name) => /^\*(Model_Space|Paper_Space\d*)$/i.test(name);
  const reachable = new Set();
  const pending = view.references.filter((reference) => !reference.containerRecordId).map((reference) => reference.definitionRecordId);
  while (pending.length) {
    const id = pending.pop();
    if (reachable.has(id)) continue;
    reachable.add(id);
    for (const reference of view.references) if (reference.containerRecordId === id) pending.push(reference.definitionRecordId);
  }
  const sourceDefinitions = view.definitions.filter((definition) => reachable.has(definition.recordId) && !systemBlock(definition.name));
  const layers = createLayers([...new Set(records.filter((record) => ["BLOCKS", "ENTITIES"].includes(record.section)).map((record) => dxfGroup(record, 8, "0")))]);
  const names = new Set((drawing.blockDefinitions ?? []).map((definition) => definition.name.toUpperCase()));
  const definitions = sourceDefinitions.map((source) => {
    if (source.flags & (4 | 8 | 16 | 32 | 64) || source.xrefPath) throw new Error("XREFブロックは未対応です。");
    if (source.basePoint.z !== 0) throw new Error("3D BLOCK基点は未対応です。");
    const baseName = decodeDxfText(source.name);
    let name = baseName, suffix = 1;
    while (names.has(name.toUpperCase())) name = `${baseName.slice(0, 240)}_${suffix++}`;
    names.add(name.toUpperCase());
    return { id: `block_${crypto.randomUUID()}`, name, basePoint: { x: source.basePoint.x, y: source.basePoint.y }, entities: [], attributeDefinitions: [] };
  });
  const definitionIds = new Map(sourceDefinitions.map((source, index) => [source.recordId, definitions[index].id]));
  const references = new Map(view.references.map((reference) => [reference.recordId, reference]));
  function checkPlanar(record) {
    for (const code of [30, 31, 38, 39, 210, 220]) if (Number(dxfGroup(record, code, 0)) !== 0) throw new Error(`${record.type}: 3D/OCS/厚さは未対応です。`);
    if (Number(dxfGroup(record, 230, 1)) !== 1 || Number(dxfGroup(record, 67, 0)) !== 0) throw new Error(`${record.type}: OCS/紙空間は未対応です。`);
  }
  function attribute(source) {
    const record = recordsById.get(source.recordId);
    checkPlanar(record);
    if ([72, 74, 71, 51].some((code) => Number(dxfGroup(record, code, 0)) !== 0) || Number(dxfGroup(record, 41, 1)) !== 1 || record.groups.some((group) => group.code === 101)) {
      throw new Error("属性の整列・傾斜・MTEXTは未対応です。");
    }
    return { id: `attr_${crypto.randomUUID()}`, dxfRecordId: source.recordId, tag: decodeDxfText(source.tag), value: decodeDxfText(source.value), prompt: decodeDxfText(source.prompt),
      at: { x: source.position.x, y: source.position.y }, size: source.height, rotation: source.rotation,
      flags: source.flags, styleName: source.style, layerId: layers.resolve(source.layer) };
  }
  function entity(record) {
    checkPlanar(record);
    const layerId = layers.resolve(dxfGroup(record, 8, "0"));
    if (record.type === "INSERT") {
      const source = references.get(record.id);
      if (!source || source.scale.x <= 0 || source.scale.z <= 0 || source.scale.x !== source.scale.y || source.rows !== 1 || source.columns !== 1) {
        throw new Error("INSERTの非一様尺度・鏡像・配列は未対応です。");
      }
      const reference = blockReference(layerId, definitionIds.get(source.definitionRecordId), source.position, { rotation: source.rotation, scale: source.scale.x, scaleZ: source.scale.z });
      reference.dxfRecordId = record.id;
      if (!reference.definitionId) throw new Error(`INSERT定義が未対応です: ${source.name}`);
      reference.attributeReferences = source.attributes.map((sourceAttribute) => {
        const value = attribute(sourceAttribute);
        const translated = transformEntity({ ...value, type: "text" }, { dx: -source.position.x, dy: -source.position.y });
        const local = transformEntity(translated, { angle: -source.rotation, scale: 1 / source.scale.x });
        return { ...value, at: local.at, size: local.size, rotation: local.rotation };
      });
      return reference;
    }
    if (!["LINE", "CIRCLE", "ARC", "LWPOLYLINE", "TEXT"].includes(record.type)) throw new Error(`BLOCK図面内の${record.type}は未対応です。`);
    if (record.type === "LWPOLYLINE" && record.groups.some((group) => [40, 41, 42, 43].includes(group.code) && Number(group.value) !== 0)) {
      throw new Error("BLOCK内の幅・bulge付きポリラインは未対応です。");
    }
    if (record.type === "TEXT" && ([71, 72, 73, 51].some((code) => Number(dxfGroup(record, code, 0)) !== 0) || Number(dxfGroup(record, 41, 1)) !== 1)) {
      throw new Error("BLOCK図面内の整列・傾斜TEXTは未対応です。");
    }
    const normalized = parsePrimitive(record, layerId);
    normalized.dxfRecordId = record.id;
    if (normalized.type === "text") {
      normalized.rotation = Number(dxfGroup(record, 50, 0));
      normalized.value = decodeDxfText(normalized.value);
      normalized.styleName = dxfGroup(record, 7, "STANDARD");
    }
    return normalized;
  }
  for (const [index, source] of sourceDefinitions.entries()) {
    definitions[index].entities = source.entityRecordIds.map((id) => recordsById.get(id)).filter((record) => !["ATTDEF", "ATTRIB", "SEQEND"].includes(record.type)).map(entity);
    definitions[index].attributeDefinitions = source.attributeDefinitions.map(attribute);
  }
  const entities = records.filter((record) => record.section === "ENTITIES" && !["ATTRIB", "SEQEND"].includes(record.type)).map(entity);
  return { definitions, entities, layers, document };
}
