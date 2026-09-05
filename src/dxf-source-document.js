// Source documents are lossless archives, not editable CAD drawings. Semantic
// views retain record IDs so later native adapters can keep source provenance.
const FORMAT = "mirai-dxf-source";

export function createDxfSourceDocument(source) {
  if (typeof source !== "string") throw new Error("DXF source must be text");
  const document = { format: FORMAT, version: 1, source };
  inspectDxfSourceDocument(document);
  return document;
}

export function restoreDxfSourceDocument(document) {
  inspectDxfSourceDocument(document);
  return document.source;
}

export function inspectDxfSourceDocument(document) {
  if (document?.format !== FORMAT || document.version !== 1 || typeof document.source !== "string") {
    throw new Error("Unsupported DXF source document");
  }
  const lines = document.source.replace(/^\uFEFF/, "").split(/\r\n|\n|\r/);
  if (lines.at(-1) === "") lines.pop();
  if (lines.length % 2) throw new Error("Incomplete DXF group pair");
  const sections = [], records = [];
  let section = null, record = null, ended = false;
  for (let i = 0; i < lines.length; i += 2) {
    if (!/^\s*\d+\s*$/.test(lines[i])) throw new Error(`Invalid DXF group code at line ${i + 1}`);
    const code = Number(lines[i]), value = lines[i + 1], token = value.trim();
    if (ended) throw new Error("Data after DXF EOF");
    if (code === 0 && token === "SECTION") {
      if (section) throw new Error("Nested DXF section");
      if (lines[i + 2]?.trim() !== "2" || !lines[i + 3]?.trim()) throw new Error("Missing DXF section name");
      section = { name: lines[i + 3].trim(), records: [], header: [] };
      sections.push(section);
      record = null;
      i += 2;
    } else if (code === 0 && token === "ENDSEC") {
      if (!section) throw new Error("Unexpected DXF ENDSEC");
      section = null;
      record = null;
    } else if (code === 0 && token === "EOF") {
      if (section) throw new Error("Unclosed DXF section");
      ended = true;
    } else if (section) {
      if (code === 0) {
        record = { id: `record-${records.length}`, type: token, section: section.name, groups: [] };
        section.records.push(record);
        records.push(record);
      }
      (record ? record.groups : section.header).push({ code, value });
    } else if (code !== 999) {
      throw new Error("DXF data outside section");
    }
  }
  if (!ended || !sections.length) throw new Error("Missing DXF sections or EOF");
  return { sections, records };
}

export function dxfGroup(record, code, fallback = undefined) {
  let applicationDepth = 0;
  for (const group of record.groups) {
    // Reactor/extension-dictionary groups can precede the entity owner (330).
    if (group.code === 102 && group.value.trim().startsWith("{")) { applicationDepth++; continue; }
    if (group.code === 102 && group.value.trim() === "}") { applicationDepth = Math.max(0, applicationDepth - 1); continue; }
    if (!applicationDepth && group.code === code) return group.value;
  }
  return fallback;
}

function numeric(record, code, fallback) {
  const raw = dxfGroup(record, code);
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!raw.trim() || !Number.isFinite(value)) throw new Error(`Invalid numeric group ${code} in ${record.id}`);
  return value;
}

function position(record, code = 10) {
  return { x: numeric(record, code, 0), y: numeric(record, code + 10, 0), z: numeric(record, code + 20, 0) };
}

function attribute(record) {
  return {
    recordId: record.id, handle: dxfGroup(record, 5), tag: dxfGroup(record, 2, ""),
    value: dxfGroup(record, 1, ""), prompt: dxfGroup(record, 3, ""),
    flags: numeric(record, 70, 0), position: position(record), alignment: position(record, 11),
    height: numeric(record, 40, 0), rotation: numeric(record, 50, 0),
    style: dxfGroup(record, 7, "STANDARD"), layer: dxfGroup(record, 8, "0")
  };
}

// References keep independent XYZ scales, OCS normal, array parameters and
// ordered attributes. Do not flatten them into the legacy children/scale model.
export function inspectDxfBlocks(document) {
  const { sections } = inspectDxfSourceDocument(document);
  const definitions = [], references = [], diagnostics = [];
  for (const section of sections.filter((item) => ["BLOCKS", "ENTITIES"].includes(item.name))) {
    let definition = null, insert = null;
    for (const record of section.records) {
      if (record.type === "BLOCK") {
        if (definition) diagnostics.push(`Unclosed BLOCK ${definition.name}`);
        definition = {
          recordId: record.id, name: dxfGroup(record, 2, ""), handle: dxfGroup(record, 5),
          owner: dxfGroup(record, 330), basePoint: position(record), flags: numeric(record, 70, 0),
          xrefPath: dxfGroup(record, 1, ""), entityRecordIds: [], attributeDefinitions: []
        };
        definitions.push(definition);
      } else if (record.type === "ENDBLK") {
        if (!definition) diagnostics.push(`Orphan ENDBLK ${record.id}`);
        definition = null;
      } else if (definition) {
        definition.entityRecordIds.push(record.id);
        if (record.type === "ATTDEF") definition.attributeDefinitions.push(attribute(record));
      }
      if (record.type === "INSERT") {
        if (insert?.followsAttributes) diagnostics.push(`Missing SEQEND for ${insert.recordId}`);
        insert = {
          recordId: record.id, handle: dxfGroup(record, 5), name: dxfGroup(record, 2, ""),
          containerRecordId: definition?.recordId ?? null,
          layer: dxfGroup(record, 8, "0"), position: position(record),
          scale: { x: numeric(record, 41, 1), y: numeric(record, 42, 1), z: numeric(record, 43, 1) },
          rotation: numeric(record, 50, 0), normal: {
            x: numeric(record, 210, 0), y: numeric(record, 220, 0), z: numeric(record, 230, 1)
          },
          columns: numeric(record, 70, 1), rows: numeric(record, 71, 1),
          columnSpacing: numeric(record, 44, 0), rowSpacing: numeric(record, 45, 0),
          paperSpace: numeric(record, 67, 0), layout: dxfGroup(record, 410),
          followsAttributes: numeric(record, 66, 0) === 1, attributes: []
        };
        references.push(insert);
      } else if (record.type === "ATTRIB") {
        if (!insert?.followsAttributes) diagnostics.push(`Orphan ATTRIB ${record.id}`);
        else insert.attributes.push(attribute(record));
      } else {
        if (insert?.followsAttributes && record.type !== "SEQEND") diagnostics.push(`Missing SEQEND for ${insert.recordId}`);
        insert = null;
      }
    }
    if (definition) diagnostics.push(`Unclosed BLOCK ${definition.name}`);
    if (insert?.followsAttributes) diagnostics.push(`Missing SEQEND for ${insert.recordId}`);
  }
  const byName = new Map();
  for (const definition of definitions) {
    const key = definition.name.toUpperCase();
    if (byName.has(key)) diagnostics.push(`Duplicate BLOCK ${definition.name}`);
    else byName.set(key, definition);
  }
  for (const reference of references) {
    reference.definitionRecordId = byName.get(reference.name.toUpperCase())?.recordId ?? null;
    if (!reference.definitionRecordId) diagnostics.push(`Missing BLOCK ${reference.name} for ${reference.recordId}`);
  }
  return { definitions, references, diagnostics };
}
