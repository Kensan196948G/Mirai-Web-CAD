// ASCII DXF書出し。80-90%代替方針Phase 1(P1-03a: DXF書出し実装)の最初の一歩。
//
// 設計方針:
// - 内部CADモデル(cad-core.jsのDrawing型)から、AutoCAD/ARES等が読める最小限のASCII DXF(R2000系)
//   を生成する。純関数でありNode(CLI/テスト)とブラウザ(UI書出し)の両方から利用できる。
// - 対象entity: line→LINE, circle→CIRCLE, arc→ARC, polyline→LWPOLYLINE(閉鎖フラグ70=1)、
//   text→TEXT(高さ40)。rectは閉鎖LWPOLYLINE(4頂点)として書出す(DXFにrect概念がないため)。
//   dimension / hatch / block は現PhaseではDXFへ安全に写像できないため「黙って捨てず」、
//   構造化されたskippedリストとして返す(未対応entity非破棄ポリシーの書出し側適用)。
// - 書出し座標は1e-9単位へ丸める(絶対許容差0.01mmのTOLERANCE_V0に対して十分な精度)。
//   レイヤ色は近傍ACI(代表16色)へ近似する(真色420・CTB/STB対応は後続Phase)。
// - dxf-parserで再importした際、importers.jsが生成するDrawingと比較器(compareDrawings)の
//   9軸採点が成り立つこと(座標・層名・文字内容・閉鎖状態の保持)をこのモジュールの合格基準とする。
//
// 生成するDXF構造(最小限だが一般的なCADが読める構成):
//   HEADER($ACADVER/$INSUNITS) + TABLES(LAYER) + ENTITIES + EOF

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
  const lines = [];
  const skipped = [];
  const warnings = [];
  const layerNameById = new Map((drawing.layers ?? []).map((layer) => [layer.id, layer.name]));

  appendHeader(lines, drawing);
  appendLayerTable(lines, drawing, layerNameById);

  let exported = 0;
  lines.push("0", "SECTION", "2", "ENTITIES");
  for (const entity of drawing.entities ?? []) {
    const encoded = encodeEntity(entity, layerNameById, warnings, skipped);
    if (!encoded) continue;
    lines.push(...encoded);
    exported += 1;
  }
  lines.push("0", "ENDSEC", "0", "EOF");

  return { content: lines.join("\n"), exported, skipped, warnings };
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
  lines.push("0", "SECTION", "2", "TABLES", "0", "TABLE", "2", "LAYER", "70", String(layerNameById.size));
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
  lines.push("0", "ENDTAB", "0", "ENDSEC");
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
function encodeEntity(entity, layerNameById, warnings, skipped) {
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
      return ["0", "TEXT", ...base, ...point(at, 10), "40", num(size), "1", value];
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
