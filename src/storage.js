const STORAGE_KEY = "mirai-web-cad-mvp";

export function loadDrawing() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return isStoredDrawing(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function isStoredDrawing(value) {
  return Boolean(
    value &&
      value.schemaVersion === 1 &&
      typeof value.id === "string" &&
      typeof value.name === "string" &&
      Number.isInteger(value.version) &&
      Number.isInteger(value.revision) &&
      Array.isArray(value.layers) &&
      value.layers.every(
        (layer) =>
          layer &&
          typeof layer.id === "string" &&
          typeof layer.name === "string" &&
          typeof layer.color === "string" &&
          typeof layer.visible === "boolean" &&
          typeof layer.locked === "boolean"
      ) &&
      Array.isArray(value.entities) &&
      Array.isArray(value.commandEvents) &&
      Array.isArray(value.auditLog)
  );
}

export function saveDrawing(drawing) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(drawing));
}

export function clearDrawing() {
  localStorage.removeItem(STORAGE_KEY);
}

/**
 * 書出しファイル名を生成する。図面名は日本語等のUnicodeを保持しつつ、
 * OSのファイル名として安全でない文字(/ \ : * ? " < > | と制御文字)のみを除去する。
 * @param name 図面名
 * @param version 図面バージョン
 * @param extension 拡張子(json/dxf)
 * @returns {string} e.g. "道路拡幅_仮設施工図_v1.dxf"
 */
export function drawingFilename(name, version, extension) {
  const cleaned = String(name ?? "")
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+|\.+$/g, "")
    .slice(0, 100);
  return `${cleaned || "drawing"}_v${Number.isInteger(version) ? version : 1}.${extension}`;
}

export function exportDrawingFile(drawing) {
  const blob = new Blob([JSON.stringify(drawing, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = drawingFilename(drawing.name, drawing.version, "json");
  anchor.click();
  URL.revokeObjectURL(url);
}

export function exportDxfFile(drawing, content) {
  const blob = new Blob([content], { type: "application/dxf" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = drawingFilename(drawing.name, drawing.version, "dxf");
  anchor.click();
  URL.revokeObjectURL(url);
}
