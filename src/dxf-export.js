// ASCII DXF書出し。80-90%代替方針Phase 1(P1-03a: DXF書出し実装)の最初の一歩。
//
// 設計方針:
// - 内部CADモデル(cad-core.jsのDrawing型)から、AutoCAD/ARES等が読める最小限のASCII DXF(R2000系)
//   を生成する。純関数でありNode(CLI/テスト)とブラウザ(UI書出し)の両方から利用できる。
// - 対象entity: line→LINE, circle→CIRCLE, arc→ARC, ellipse→ELLIPSE, spline→SPLINE、
//   polyline→LWPOLYLINE(閉鎖フラグ70=1)、
//   text→TEXT(高さ40)。rectは閉鎖LWPOLYLINE(4頂点)として書出す(DXFにrect概念がないため)。
//   dimension / hatch / 旧children型block は現PhaseではDXFへ安全に写像できないため「黙って捨てず」、
//   構造化されたskippedリストとして返す(未対応entity非破棄ポリシーの書出し側適用)。
//   definitionId付きblockは通常2D BLOCK/INSERT/属性として限定再生成する。
// - 書出し座標は1e-9単位へ丸める(絶対許容差0.01mmのTOLERANCE_V0に対して十分な精度)。
//   レイヤ色は近傍ACI(代表16色)へ近似する(真色420・CTB/STB対応は後続Phase)。
// - dxf-parserで再importした際、importers.jsが生成するDrawingと比較器(compareDrawings)の
//   9軸採点が成り立つこと(座標・層名・文字内容・閉鎖状態の保持)をこのモジュールの合格基準とする。
//
// 生成するDXF構造(最小限だが一般的なCADが読める構成):
//   HEADER($ACADVER/$INSUNITS) + TABLES(LAYER) + ENTITIES + EOF

import { resolveBlocks, blockAttributeText } from "./cad-block.js";
import { affineText, blockAffine } from "./cad-affine.js";
import { exportDxfFromSource } from "./dxf-source-export.js";

/** 色相の近傍ACI探索に使う代表色(RGB)。AutoCAD標準色(1〜9)とグレー(250〜255)の近似値。 */
const ACI_ANCHORS = [
  { index: 1, r: 255, g: 0, b: 0 }, // Red
  { index: 2, r: 255, g: 255, b: 0 }, // Yellow
  { index: 3, r: 0, g: 255, b: 0 }, // Green
  { index: 4, r: 0, g: 255, b: 255 }, // Cyan
  { index: 5, r: 0, g: 0, b: 255 }, // Blue
  { index: 6, r: 255, g: 0, b: 255 }, // Magenta
  { index: 7, r: 255, g: 255, b: 255 }, // White/Black
  { index: 8, r: 128, g: 128, b: 128 }, // Gray
  { index: 9, r: 192, g: 192, b: 192 }, // Light Gray
  { index: 250, r: 51, g: 51, b: 51 },
  { index: 251, r: 80, g: 80, b: 80 },
  { index: 252, r: 105, g: 105, b: 105 },
  { index: 253, r: 130, g: 130, b: 130 },
  { index: 254, r: 155, g: 155, b: 155 },
  { index: 255, r: 180, g: 180, b: 180 }
];

const CONTINUOUS_LINETYPE = "CONTINUOUS";

/**
 * Drawing(cad-core.js)をASCII DXF文字列へ変換する。
 * @param drawing
 * @returns {{ content: string, exported: number, skipped: Array<{type: string, id: string, reason: string}>, warnings: string[] }}
 */
export function exportDxf(drawing) {
  drawing = structuredClone(drawing);
  resolveBlocks(drawing);
  let preservationFailure = "";
  if (drawing.dxfSources?.length) {
    try {
      const preserved = exportDxfFromSource(drawing, encodeDxfEntityRecord, encodeDxfBlockDefinition);
      if (preserved) return preserved;
      preservationFailure = "原本保持の対象外の編集があるため限定再生成します。";
    } catch (error) {
      preservationFailure = `原本保持を適用できません: ${error instanceof Error ? error.message : String(error)}`;
    }
  }
  const lines = [];
  const skipped = [];
  const warnings = [];
  if (preservationFailure) warnings.push(preservationFailure);
  const layerNameById = new Map((drawing.layers ?? []).map((layer) => [layer.id, layer.name]));
  const definitions = new Map((drawing.blockDefinitions ?? []).map((definition) => [definition.id, definition.name]));
  if (drawing.dxfSources?.length) warnings.push("限定DXF再生成: 原本のTABLES・OBJECTS・表現属性の完全保持は未対応です。原本はJSON書出しのdxfSourcesに保持されています。");

  appendHeader(lines, drawing);
  appendLayerTable(lines, drawing, layerNameById);
  appendBlocks(lines, drawing, layerNameById, warnings, skipped, definitions);

  let exported = 0;
  lines.push("0", "SECTION", "2", "ENTITIES");
  for (const entity of drawing.entities ?? []) {
    const encoded = encodeEntity(entity, layerNameById, warnings, skipped, definitions);
    if (!encoded) continue;
    lines.push(...encoded);
    exported += 1;
  }
  lines.push("0", "ENDSEC", "0", "EOF");

  return { content: lines.map((value) => definitions.size ? dxfText(value) : value).join("\n"), exported, skipped, warnings };
}

function appendHeader(lines, drawing) {
  const insunits = drawing.unit === "m" ? 6 : 4; // AutoCAD INSUNITS: 4=mm, 6=m
  lines.push(
    "0", "SECTION", "2", "HEADER",
    "9", "$ACADVER", "1", "AC1015",
    "9", "$INSUNITS", "70", String(insunits),
    "0", "ENDSEC"
  );
}

function appendLayerTable(lines, drawing, layerNameById) {
  lines.push("0", "SECTION", "2", "TABLES", "0", "TABLE", "2", "LAYER", "5", "F00", "100", "AcDbSymbolTable", "70", String(layerNameById.size));
  for (const layer of drawing.layers ?? []) {
    if (!layerNameById.has(layer.id)) continue;
    lines.push(
      "0", "LAYER",
      "2", sanitizeName(layer.name),
      "70", "0",
      "62", String(aciForColor(layer.color)),
      "6", CONTINUOUS_LINETYPE
    );
  }
  lines.push("0", "ENDTAB");
  if (drawing.blockDefinitions?.length) {
    const names = ["*Model_Space", "*Paper_Space", ...drawing.blockDefinitions.map((definition) => definition.name)];
    lines.push("0", "TABLE", "2", "BLOCK_RECORD", "5", "F01", "100", "AcDbSymbolTable", "70", String(names.length));
    names.forEach((name, index) => lines.push("0", "BLOCK_RECORD", "5", (4096 + index).toString(16), "100", "AcDbSymbolTableRecord", "100", "AcDbBlockTableRecord", "2", sanitizeName(name), "70", "0"));
    lines.push("0", "ENDTAB");
    const styles = new Set(["STANDARD"]);
    const collect = (entity) => { if (entity.styleName) styles.add(entity.styleName); for (const attribute of entity.attributeReferences ?? []) if (attribute.styleName) styles.add(attribute.styleName); };
    drawing.entities.forEach(collect);
    for (const definition of drawing.blockDefinitions) { definition.entities.forEach(collect); definition.attributeDefinitions.forEach(collect); }
    lines.push("0", "TABLE", "2", "STYLE", "5", "F02", "100", "AcDbSymbolTable", "70", String(styles.size));
    for (const name of styles) lines.push("0", "STYLE", "100", "AcDbSymbolTableRecord", "100", "AcDbTextStyleTableRecord", "2", dxfText(name), "70", "0", "40", "0", "41", "1", "50", "0", "71", "0", "42", "1", "3", "txt", "4", "");
    lines.push("0", "ENDTAB");
  }
  lines.push("0", "ENDSEC");
}

function appendBlocks(lines, drawing, layers, warnings, skipped, definitions) {
  if (!drawing.blockDefinitions?.length) return;
  lines.push("0", "SECTION", "2", "BLOCKS");
  const all = [{ name: "*Model_Space", basePoint: { x: 0, y: 0 }, entities: [], attributeDefinitions: [] },
    { name: "*Paper_Space", basePoint: { x: 0, y: 0 }, entities: [], attributeDefinitions: [] }, ...drawing.blockDefinitions];
  all.forEach((definition, index) => {
    const owner = (4096 + index).toString(16);
    lines.push("0", "BLOCK", "330", owner, "100", "AcDbEntity", "8", "0", "100", "AcDbBlockBegin", "2", sanitizeName(definition.name), "70", definition.attributeDefinitions.length ? "2" : "0", ...point(definition.basePoint, 10), "3", sanitizeName(definition.name), "1", "");
    for (const entity of definition.entities) {
      const encoded = encodeEntity(entity, layers, warnings, skipped, definitions);
      if (encoded) lines.push(...encoded);
    }
    for (const attribute of definition.attributeDefinitions) lines.push(...encodeAttribute(attribute, "ATTDEF", layers));
    lines.push("0", "ENDBLK", "330", owner, "100", "AcDbEntity", "8", "0", "100", "AcDbBlockEnd");
  });
  lines.push("0", "ENDSEC");
}

function dxfText(value) {
  return String(value ?? "").replace(/[\r\n]/g, " ").replace(/[^\x00-\x7f]/g, (character) => `\\U+${character.charCodeAt(0).toString(16).padStart(4, "0").toUpperCase()}`);
}

function encodeAttribute(attribute, type, layers) {
  return ["0", type, "100", "AcDbEntity", "8", sanitizeName(layers.get(attribute.layerId) ?? "0"), "100", "AcDbText",
    ...point(attribute.at, 10), "40", num(attribute.size), "1", dxfText(attribute.value), "50", num(attribute.rotation ?? 0), "7", dxfText(attribute.styleName ?? "STANDARD"), ...textTransformGroups(attribute),
    "100", type === "ATTDEF" ? "AcDbAttributeDefinition" : "AcDbAttribute", ...(type === "ATTDEF" ? ["3", dxfText(attribute.prompt ?? "")] : []), "2", dxfText(attribute.tag), "70", String(attribute.flags ?? 0)];
}

function textTransformGroups(entity) {
  return ["41", num(entity.widthFactor ?? 1), "51", num(entity.oblique ?? 0), "71", String(entity.generationFlags ?? 0)];
}

/**
 * entity1件をDXF groupコード列へ変換する。変換不能/未対応entityはnullを返し、
 * skippedへ構造化レコードを積む(黙って破棄しない)。
 * @param entity
 * @param layerNameById
 * @param warnings
 * @param skipped
 * @returns {string[] | null}
 */
function encodeEntity(entity, layerNameById, warnings, skipped, definitions = new Map()) {
  const encoded = encodeEntityBody(entity, layerNameById, warnings, skipped, definitions);
  if (!encoded || !definitions.size || entity.type === "block") return encoded;
  const subclass = { LINE: "AcDbLine", CIRCLE: "AcDbCircle", ARC: "AcDbCircle", LWPOLYLINE: "AcDbPolyline", TEXT: "AcDbText", ELLIPSE: "AcDbEllipse", SPLINE: "AcDbSpline" }[encoded[1]];
  if (!subclass) return encoded;
  const result = [...encoded.slice(0, 2), "100", "AcDbEntity", ...encoded.slice(2, 4), "100", subclass, ...encoded.slice(4)];
  if (entity.type === "arc") {
    const index = result.findIndex((value, i) => i % 2 === 0 && value === "50");
    result.splice(index, 0, "100", "AcDbArc");
  }
  return result;
}

export function encodeDxfEntityRecord(entity, drawing) {
  const layers = new Map((drawing.layers ?? []).map((layer) => [layer.id, layer.name]));
  const definitions = new Map((drawing.blockDefinitions ?? []).map((definition) => [definition.id, definition.name]));
  const warnings = [], skipped = [];
  const groups = encodeEntity(entity, layers, warnings, skipped, definitions);
  if (!groups || skipped.length) throw new Error(skipped[0]?.reason ?? "DXF entity encoding failed");
  return groups.map(dxfText).join("\n") + "\n";
}

export function encodeDxfBlockDefinition(definition, drawing, owner) {
  const layers = new Map((drawing.layers ?? []).map((layer) => [layer.id, layer.name]));
  const definitions = new Map((drawing.blockDefinitions ?? []).map((item) => [item.id, item.name]));
  const lines = ["0", "BLOCK", "330", owner, "100", "AcDbEntity", "8", "0", "100", "AcDbBlockBegin", "2", sanitizeName(definition.name),
    "70", definition.attributeDefinitions.length ? "2" : "0", ...point(definition.basePoint, 10), "3", sanitizeName(definition.name), "1", ""];
  const warnings = [], skipped = [];
  for (const entity of definition.entities) {
    const encoded = encodeEntity(entity, layers, warnings, skipped, definitions);
    if (encoded) lines.push(...encoded);
  }
  for (const attribute of definition.attributeDefinitions) lines.push(...encodeAttribute(attribute, "ATTDEF", layers));
  if (skipped.length) throw new Error(skipped[0].reason);
  lines.push("0", "ENDBLK", "330", owner, "100", "AcDbEntity", "8", "0", "100", "AcDbBlockEnd");
  return lines.map(dxfText).join("\n") + "\n";
}

function encodeEntityBody(entity, layerNameById, warnings, skipped, definitions) {
  if (!entity || typeof entity !== "object" || typeof entity.id !== "string" || typeof entity.type !== "string") {
    return null;
  }
  const layerName = layerNameById.has(entity.layerId) ? sanitizeName(layerNameById.get(entity.layerId)) : null;
  if (layerName === null) {
    skipped.push({ type: entity.type, id: entity.id, reason: "存在しないレイヤーを参照しています" });
    return null;
  }
  const base = ["8", layerName];
  switch (entity.type) {
    case "block": {
      if (!entity.definitionId) return skipEntity(entity, skipped, "旧children型BLOCKのDXF書出しは未対応です。");
      const name = definitions.get(entity.definitionId);
      if (!name) return skipEntity(entity, skipped, "BLOCK定義がありません。");
      const groups = ["0", "INSERT", "100", "AcDbEntity", ...base, "100", "AcDbBlockReference", "2", sanitizeName(name), ...point(entity.insertion, 10), "41", num(entity.scale*(entity.axisScale?.x ?? 1)), "42", num(entity.scale*(entity.axisScale?.y ?? 1)), "43", num(entity.scaleZ ?? entity.scale), "50", num(entity.rotation)];
      if (entity.attributeReferences.length) {
        groups.push("66", "1");
        for (const attribute of entity.attributeReferences) {
          const world = affineText(blockAttributeText(attribute), blockAffine(entity));
          groups.push(...encodeAttribute({ ...attribute, at: world.at, size: world.size, rotation: world.rotation, widthFactor: world.widthFactor, oblique: world.oblique, generationFlags: world.generationFlags }, "ATTRIB", layerNameById));
        }
        groups.push("0", "SEQEND", ...base);
      }
      return groups;
    }
    case "line": {
      const a = finitePoint(entity.points?.[0]);
      const b = finitePoint(entity.points?.[1]);
      if (!a || !b) return skipEntity(entity, skipped, "線分の座標が不正です");
      return ["0", "LINE", ...base, ...point(a, 10), ...point(b, 11)];
    }
    case "circle": {
      const center = finitePoint(entity.center);
      if (!center || !Number.isFinite(entity.radius) || Number(entity.radius) <= 0) {
        return skipEntity(entity, skipped, "円の中心/半径が不正です(半径は正の値が必要)");
      }
      return ["0", "CIRCLE", ...base, ...point(center, 10), "40", num(entity.radius)];
    }
    case "arc": {
      const center = finitePoint(entity.center);
      if (
        !center || !Number.isFinite(entity.radius) || Number(entity.radius) <= 0 ||
        !Number.isFinite(entity.startAngle) || !Number.isFinite(entity.endAngle) ||
        normalizedSweep(entity.startAngle, entity.endAngle) <= 1e-9
      ) {
        return skipEntity(entity, skipped, "円弧の中心/半径/角度が不正です");
      }
      return [
        "0", "ARC", ...base, ...point(center, 10), "40", num(entity.radius),
        "50", num(normalizeDegrees(entity.startAngle)), "51", num(normalizeDegrees(entity.endAngle))
      ];
    }
    case "ellipse": {
      const center = finitePoint(entity.center);
      if (
        !center || !Number.isFinite(entity.radiusX) || entity.radiusX <= 0 ||
        !Number.isFinite(entity.radiusY) || entity.radiusY <= 0 || entity.radiusY > entity.radiusX ||
        !Number.isFinite(entity.rotation) || !Number.isFinite(entity.startParameter) || !Number.isFinite(entity.endParameter)
      ) return skipEntity(entity, skipped, "楕円の中心/長半径/短半径/角度が不正です");
      const rotation = entity.rotation * Math.PI / 180;
      const majorAxis = { x: entity.radiusX * Math.cos(rotation), y: entity.radiusX * Math.sin(rotation) };
      return [
        "0", "ELLIPSE", ...base, ...point(center, 10), ...point(majorAxis, 11),
        "40", num(entity.radiusY / entity.radiusX),
        "41", num(entity.startParameter), "42", num(entity.endParameter)
      ];
    }
    case "spline": {
      const controlPoints = Array.isArray(entity.controlPoints) ? entity.controlPoints.map(finitePoint) : [];
      const degree = Number(entity.degree);
      const knots = Array.isArray(entity.knots) ? entity.knots.map(Number) : [];
      if (
        controlPoints.length < 2 || controlPoints.some((value) => !value) ||
        !Number.isInteger(degree) || degree < 1 || degree >= controlPoints.length ||
        knots.length !== controlPoints.length + degree + 1 || knots.some((value, index) => !Number.isFinite(value) || (index > 0 && value < knots[index - 1]))
      ) return skipEntity(entity, skipped, "スプラインの制御点/次数/ノット列が不正です");
      const groups = [
        "0", "SPLINE", ...base, "70", String(8 | (entity.closed ? 1 : 0)),
        "71", String(degree), "72", String(knots.length), "73", String(controlPoints.length), "74", "0"
      ];
      for (const knot of knots) groups.push("40", num(knot));
      for (const controlPoint of controlPoints) groups.push(...point(controlPoint, 10));
      return groups;
    }
    case "polyline": {
      if (!Array.isArray(entity.points) || entity.points.length < 2) return skipEntity(entity, skipped, "ポリラインの頂点が不足しています");
      const groups = ["0", "LWPOLYLINE", ...base, "90", String(entity.points.length), "70", entity.closed ? "1" : "0"];
      for (const vertex of entity.points) {
        const value = finitePoint(vertex);
        if (!value) return skipEntity(entity, skipped, "ポリラインの頂点座標が不正です");
        groups.push(...point(value, 10));
      }
      return groups;
    }
    case "rect": {
      const origin = finitePoint(entity.origin);
      if (!origin || !Number.isFinite(entity.width) || !Number.isFinite(entity.height)) {
        return skipEntity(entity, skipped, "矩形の形状が不正です");
      }
      const corners = [
        origin,
        { x: origin.x + entity.width, y: origin.y },
        { x: origin.x + entity.width, y: origin.y + entity.height },
        { x: origin.x, y: origin.y + entity.height }
      ];
      const groups = ["0", "LWPOLYLINE", ...base, "90", "4", "70", "1"];
      for (const vertex of corners) groups.push(...point(vertex, 10));
      return groups;
    }
    case "text": {
      const at = finitePoint(entity.at);
      if (!at) return skipEntity(entity, skipped, "文字の位置が不正です");
      let value = String(entity.value ?? "");
      if (/[\r\n]/.test(value)) {
        warnings.push(`text ${entity.id}: 改行を含むため空白へ変換して書出しました`);
        value = value.replace(/[\r\n]+/g, " ");
      }
      const size = Number(entity.size);
      if (!Number.isFinite(size) || size <= 0) {
        return skipEntity(entity, skipped, "文字高さが不正です(正の値が必要)");
      }
      const widthFactor = Number(entity.widthFactor ?? 1);
      const oblique = Number(entity.oblique ?? 0);
      const generationFlags = Number(entity.generationFlags ?? 0);
      if (!Number.isFinite(widthFactor) || widthFactor <= 0 || !Number.isFinite(oblique) || Math.abs(oblique) >= 90 || ![0, 2, 4, 6].includes(generationFlags)) {
        return skipEntity(entity, skipped, "文字の幅係数・傾斜角・生成フラグが不正です");
      }
      return ["0", "TEXT", ...base, ...point(at, 10), "40", num(size), "1", definitions.size ? dxfText(value) : value, "50", num(entity.rotation ?? 0), "7", dxfText(entity.styleName ?? "STANDARD"),
        ...textTransformGroups({ ...entity, widthFactor, oblique, generationFlags })];
    }
    default:
      return skipEntity(entity, skipped, "DXF書出し未対応のentity種別です(現Phase: dimension/hatch/block)");
  }
}

function skipEntity(entity, skipped, reason) {
  skipped.push({ type: entity.type, id: entity.id, reason });
  return null;
}

function finitePoint(value) {
  if (!value || typeof value !== "object") return null;
  const x = Number(value.x);
  const y = Number(value.y);
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
}

function sanitizeName(value) {
  return String(value ?? "0").replace(/[\r\n]/g, " ").slice(0, 255) || "0";
}

function num(value) {
  const rounded = Math.round(Number(value) * 1e9) / 1e9;
  return String(Object.is(rounded, -0) ? 0 : rounded);
}

function normalizeDegrees(value) {
  return ((Number(value) % 360) + 360) % 360;
}

function normalizedSweep(startAngle, endAngle) {
  return ((Number(endAngle) - Number(startAngle)) % 360 + 360) % 360;
}

/** DXF point group: コードcodeとcode+10のペアでx,yを書く(例: LINE始点は10/20、終点は11/21)。 */
function point(value, code) {
  return [String(code), num(value.x), String(code + 10), num(value.y)];
}

/** 内部カラーヘックス(#rrggbb)を最も近いACIインデックスへ近似する。 */
function aciForColor(color) {
  const hex = /^#([0-9a-f]{6})$/i.exec(String(color ?? ""));
  if (!hex) return 7;
  const r = parseInt(hex[1].slice(0, 2), 16);
  const g = parseInt(hex[1].slice(2, 4), 16);
  const b = parseInt(hex[1].slice(4, 6), 16);
  let best = ACI_ANCHORS[0];
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const anchor of ACI_ANCHORS) {
    const dr = anchor.r - r;
    const dg = anchor.g - g;
    const db = anchor.b - b;
    const distance = dr * dr + dg * dg + db * db;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = anchor;
    }
  }
  return best.index;
}
