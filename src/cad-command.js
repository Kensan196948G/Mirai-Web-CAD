import { circle, line, polyline, rect, text } from "./cad-core.js";

const TOOL_COMMANDS = {
  L: "line",
  LINE: "line",
  REC: "rect",
  RECT: "rect",
  RECTANGLE: "rect",
  C: "circle",
  CIRCLE: "circle",
  PL: "polyline",
  PLINE: "polyline",
  POLYLINE: "polyline",
  T: "text",
  TEXT: "text"
};

export function parseCadCommand(input, context) {
  const tokens = tokenize(input.trim());
  if (tokens.length === 0) return { kind: "noop" };
  const command = tokens.shift().toUpperCase();
  const tool = TOOL_COMMANDS[command];

  if (tool && tokens.length === 0) return { kind: "ui", action: "tool", tool };
  if (tool === "line") {
    requireCount(tokens, 2, "LINE x1,y1 x2,y2");
    return transaction("LINE", [{ op: "add", entity: line(context.currentLayerId, point(tokens[0]), point(tokens[1])) }]);
  }
  if (tool === "rect") {
    requireCount(tokens, 2, "RECT x1,y1 x2,y2");
    const origin = point(tokens[0]);
    const opposite = point(tokens[1]);
    return transaction("RECT", [
      {
        op: "add",
        entity: rect(
          context.currentLayerId,
          [Math.min(origin.x, opposite.x), Math.min(origin.y, opposite.y)],
          Math.abs(opposite.x - origin.x),
          Math.abs(opposite.y - origin.y)
        )
      }
    ]);
  }
  if (tool === "circle") {
    requireCount(tokens, 2, "CIRCLE x,y radius");
    const radius = number(tokens[1], "radius");
    if (radius <= 0) throw new Error("半径は0より大きい値を指定してください。");
    return transaction("CIRCLE", [
      { op: "add", entity: circle(context.currentLayerId, point(tokens[0]), radius) }
    ]);
  }
  if (tool === "polyline") {
    const closed = tokens.at(-1)?.toUpperCase() === "CLOSE";
    if (closed) tokens.pop();
    if (tokens.length < 2) throw new Error("PLINEには2点以上が必要です。");
    return transaction("PLINE", [
      { op: "add", entity: polyline(context.currentLayerId, tokens.map(point), { closed }) }
    ]);
  }
  if (tool === "text") {
    if (tokens.length < 2) throw new Error('TEXT x,y "文字" の形式で指定してください。');
    const at = point(tokens.shift());
    return transaction("TEXT", [
      { op: "add", entity: text(context.currentLayerId, at, tokens.join(" ")) }
    ]);
  }

  if (["E", "ERASE", "DELETE"].includes(command)) {
    const id = tokens[0] ?? context.selectedId;
    if (!id) throw new Error("削除する図形を選択するかIDを指定してください。");
    return transaction("ERASE", [{ op: "delete", id }]);
  }
  if (["M", "MOVE"].includes(command)) return transformCommand("MOVE", tokens, context, false);
  if (["CO", "COPY"].includes(command)) return transformCommand("COPY", tokens, context, true);
  if (["LA", "LAYER"].includes(command)) {
    if (tokens.length === 0) {
      return { kind: "message", message: context.drawing.layers.map((layer) => layer.name).join(" / ") };
    }
    const query = tokens.join(" ").toLowerCase();
    const layer = context.drawing.layers.find(
      (item) => item.id.toLowerCase() === query || item.name.toLowerCase() === query
    );
    if (!layer) throw new Error(`レイヤーが見つかりません: ${tokens.join(" ")}`);
    return { kind: "ui", action: "layer", layerId: layer.id };
  }
  if (["Z", "ZOOM"].includes(command)) {
    const option = (tokens[0] ?? "EXTENTS").toUpperCase();
    if (!["E", "EXTENTS", "ALL", "A"].includes(option)) throw new Error("ZOOMはEXTENTSに対応しています。");
    return { kind: "ui", action: "fit" };
  }
  if (["S", "SELECT"].includes(command)) {
    if (!tokens[0]) throw new Error("SELECTには図形IDが必要です。");
    if (!context.drawing.entities.some((entity) => entity.id === tokens[0])) {
      throw new Error(`図形が見つかりません: ${tokens[0]}`);
    }
    return { kind: "ui", action: "select", entityId: tokens[0] };
  }
  if (command === "NEW") return { kind: "ui", action: "new", name: tokens.join(" ") };
  if (command === "IMPORT") return { kind: "ui", action: "import" };
  if (["U", "UNDO"].includes(command)) return { kind: "ui", action: "undo" };
  if (["REDO"].includes(command)) return { kind: "ui", action: "redo" };
  if (["ESC", "CANCEL"].includes(command)) return { kind: "ui", action: "cancel" };
  if (["H", "HELP", "?"].includes(command)) {
    return {
      kind: "message",
      message: "LINE RECT CIRCLE PLINE TEXT ERASE MOVE COPY UNDO REDO SELECT LAYER ZOOM NEW IMPORT HELP"
    };
  }
  throw new Error(`未対応のコマンドです: ${command}`);
}

function transformCommand(label, tokens, context, copy) {
  let id = context.selectedId;
  if (tokens[0] && !tokens[0].includes(",")) id = tokens.shift();
  if (!id) throw new Error(`${label}する図形を選択するかIDを指定してください。`);
  const entity = context.drawing.entities.find((item) => item.id === id);
  if (!entity) throw new Error(`図形が見つかりません: ${id}`);
  requireCount(tokens, 1, `${label} [id] dx,dy`);
  const offset = point(tokens[0]);
  if (copy) {
    const next = movedEntity(entity, offset.x, offset.y);
    next.id = `e_copy_${randomId()}`;
    next.meta = { createdBy: "user", createdAt: new Date().toISOString() };
    return transaction("COPY", [{ op: "add", entity: next }]);
  }
  return transaction("MOVE", [{ op: "update", id, patch: movedPatch(entity, offset.x, offset.y) }]);
}

function movedEntity(entity, dx, dy) {
  return { ...structuredClone(entity), ...movedPatch(entity, dx, dy) };
}

function movedPatch(entity, dx, dy) {
  const patch = {};
  if (entity.points) patch.points = entity.points.map((value) => ({ x: value.x + dx, y: value.y + dy }));
  if (entity.origin) patch.origin = { x: entity.origin.x + dx, y: entity.origin.y + dy };
  if (entity.center) patch.center = { x: entity.center.x + dx, y: entity.center.y + dy };
  if (entity.at) patch.at = { x: entity.at.x + dx, y: entity.at.y + dy };
  return patch;
}

function transaction(label, commands) {
  return { kind: "transaction", label, commands };
}

function point(value) {
  const parts = String(value).split(",");
  if (parts.length !== 2) throw new Error(`座標はx,y形式で指定してください: ${value}`);
  return { x: number(parts[0], "x"), y: number(parts[1], "y") };
}

function number(value, label) {
  if (String(value).trim() === "") throw new Error(`${label}が空です。`);
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`${label}が数値ではありません: ${value}`);
  return parsed;
}

function requireCount(tokens, count, usage) {
  if (tokens.length !== count) throw new Error(`形式: ${usage}`);
}

function tokenize(value) {
  const tokens = [];
  const matcher = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let match;
  while ((match = matcher.exec(value))) tokens.push(match[1] ?? match[2] ?? match[3]);
  return tokens;
}

function randomId() {
  return globalThis.crypto?.randomUUID?.().slice(0, 8) ?? Math.random().toString(16).slice(2, 10);
}
