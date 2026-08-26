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

export function exportDrawingFile(drawing) {
  const blob = new Blob([JSON.stringify(drawing, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${drawing.name.replace(/[^\w-]+/g, "_")}_v${drawing.version}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}
