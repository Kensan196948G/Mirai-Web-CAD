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

// 保存の成否を返す。以前はtry/catchが無く、容量超過(QuotaExceededError)や
// プライベートモードでsetItemが例外を投げると呼び出し側の後続処理(画面更新・ログ)に
// 到達せず、「変更は画面に反映されたが何も永続化されていない」無言のデータ喪失になっていた。
// @returns {{ ok: true } | { ok: false, reason: string }}
export function saveDrawing(drawing) {
  let serialized;
  try {
    serialized = JSON.stringify(drawing);
  } catch {
    return { ok: false, reason: "図面データをJSONへ変換できませんでした。" };
  }
  try {
    localStorage.setItem(STORAGE_KEY, serialized);
    return { ok: true };
  } catch (error) {
    const quota = error instanceof DOMException && (error.name === "QuotaExceededError" || error.code === 22);
    return {
      ok: false,
      reason: quota
        ? "ブラウザの保存領域が不足しています。JSON書出しで退避し、不要な図面を整理してください。"
        : "ブラウザへ保存できませんでした(プライベートモード等)。JSON書出しで退避してください。"
    };
  }
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

// ダウンロードを開始する。anchorをDOMへ接続し、ObjectURLのrevokeを次のタスクへ遅らせる。
// 以前は接続しないままclick直後に同期revokeしていたため、Firefox/WebKitで
// ダウンロードが失敗し得た(書出しが無言で失敗する経路)。
function triggerDownload(url, filename) {
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function exportDrawingFile(drawing) {
  const blob = new Blob([JSON.stringify(drawing, null, 2)], { type: "application/json" });
  triggerDownload(URL.createObjectURL(blob), drawingFilename(drawing.name, drawing.version, "json"));
}

export function exportDxfFile(drawing, content) {
  const blob = new Blob([content], { type: "application/dxf" });
  triggerDownload(URL.createObjectURL(blob), drawingFilename(drawing.name, drawing.version, "dxf"));
}
