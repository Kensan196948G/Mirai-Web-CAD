import {
  ROLE_POLICIES,
  applyTransaction,
  approveDrawing,
  buildAiProposal,
  createDrawing,
  circle,
  createNewVersion,
  hitTest,
  line,
  measurements,
  polyline,
  proposalToTransaction,
  rect,
  seedDrawing,
  submitForReview,
  text,
  validateDrawing
} from "./cad-core.js";
import { clearDrawing, exportDrawingFile, loadDrawing, saveDrawing } from "./storage.js";

const VIEW_MODES = new Set(["normal", "empty", "loading", "error"]);
const requestedViewMode = new URLSearchParams(location.search).get("state") ?? "normal";

const state = {
  drawing: loadDrawing() ?? seedDrawing(),
  tool: "select",
  currentLayerId: "layer-structure",
  selectedId: null,
  draftPoints: [],
  previewProposal: null,
  previewRunId: null,
  camera: { x: 50, y: 40, scale: 0.075 },
  commandLog: ["起動: Mirai Web CAD MVP"],
  drag: null,
  viewMode: VIEW_MODES.has(requestedViewMode) ? requestedViewMode : "normal",
  apiStatus: { state: "idle", message: "未確認" }
};

const app = document.querySelector("#app");

function render() {
  const drawing = activeDrawing();
  app.innerHTML = `
    <header class="topbar">
      <div>
        <p class="eyebrow">AGENTIC 2D CAD MVP</p>
        <h1>Mirai Web CAD</h1>
      </div>
      <div class="drawing-meta" aria-label="図面状態">
        <span>v${escapeHtml(drawing.version)}</span>
        <span>${escapeHtml(stateLabel(drawing.state))}</span>
        <label>
          権限
          <select id="roleSelect" aria-label="権限を切替">
            ${Object.entries(ROLE_POLICIES)
              .map(
                ([role, policy]) =>
                  `<option value="${role}" ${state.drawing.currentRole === role ? "selected" : ""}>${policy.label}</option>`
              )
              .join("")}
          </select>
        </label>
      </div>
    </header>

    <main class="workspace">
      <aside class="rail" aria-label="作図ツール">
        <div class="section-title">Draw</div>
        ${toolButton("select", "↖", "選択")}
        ${toolButton("line", "／", "線")}
        ${toolButton("rect", "□", "矩形")}
        ${toolButton("circle", "○", "円")}
        ${toolButton("polyline", "⌁", "ポリライン")}
        ${toolButton("text", "T", "文字")}
        <div class="section-title">Edit</div>
        <button id="deleteBtn" class="icon-button" title="削除" aria-label="選択図形を削除">⌫</button>
        <button id="fitBtn" class="icon-button" title="全体表示" aria-label="全体表示">⛶</button>
        <button id="exportBtn" class="icon-button" title="JSON出力" aria-label="JSON出力">⇩</button>
        <button id="resetBtn" class="icon-button danger" title="デモ初期化" aria-label="デモ初期化">↺</button>
      </aside>

      <section class="canvas-panel" aria-label="CADキャンバス">
        <div class="canvas-toolbar">
          <label>
            レイヤー
            <select id="layerSelect" aria-label="現在レイヤー">
              ${drawing.layers
                .map(
                  (layer) =>
                    `<option value="${escapeHtml(layer.id)}" ${state.currentLayerId === layer.id ? "selected" : ""}>${escapeHtml(
                      layer.name
                    )}</option>`
                )
                .join("")}
            </select>
          </label>
          <span>${escapeHtml(state.tool.toUpperCase())}</span>
          <span>${state.selectedId ? `選択: ${escapeHtml(state.selectedId)}` : "未選択"}</span>
          <span>表示状態: ${escapeHtml(viewModeLabel(state.viewMode))}</span>
        </div>
        <canvas id="cadCanvas" width="1180" height="760" tabindex="0" aria-label="作図キャンバス"></canvas>
      </section>

      <aside class="inspector" aria-label="検査とAI">
        <section>
          <h2>State Review</h2>
          <div class="segmented" role="group" aria-label="表示状態を切替">
            ${stateButton("normal", "正常")}
            ${stateButton("empty", "空")}
            ${stateButton("loading", "Loading")}
            ${stateButton("error", "Error")}
          </div>
          <div class="api-status ${state.apiStatus.state}">
            <span>API</span>
            <b>${escapeHtml(state.apiStatus.message)}</b>
          </div>
          <button id="apiHealthBtn" class="wide">API Health</button>
        </section>

        <section>
          <h2>AI Agent</h2>
          <textarea id="aiPrompt" rows="3" placeholder="例: クレーンの重機範囲を追加"></textarea>
          <div class="button-row">
            <button id="planAiBtn">Preview</button>
            <button id="applyAiBtn" ${state.previewProposal?.status === "planned" ? "" : "disabled"}>承認して適用</button>
          </div>
          <div id="aiPreview" class="preview-box">${proposalHtml()}</div>
        </section>

        <section>
          <h2>Layers</h2>
          <div class="layer-list">
            ${drawing.layers
              .map(
                (layer) => `
                  <label class="layer-row">
                    <input type="checkbox" data-layer-visible="${escapeHtml(layer.id)}" ${layer.visible ? "checked" : ""} />
                    <span class="swatch" style="background:${safeColor(layer.color)}"></span>
                    <span>${escapeHtml(layer.name)}</span>
                    <button data-layer-lock="${escapeHtml(layer.id)}" class="mini ${
                      layer.locked ? "locked" : ""
                    }" title="ロック切替">${
                      layer.locked ? "Lock" : "Open"
                    }</button>
                  </label>
                `
              )
              .join("")}
          </div>
        </section>

        <section>
          <h2>Inspection</h2>
          ${inspectionHtml()}
          <div class="button-row">
            <button id="reviewBtn">レビュー提出</button>
            <button id="approveBtn">承認</button>
            <button id="newVersionBtn">新版</button>
          </div>
        </section>

        <section>
          <h2>Quantity</h2>
          ${quantityHtml()}
        </section>
      </aside>
    </main>

    <footer class="command-line" aria-label="コマンドログ">
      ${state.commandLog.slice(-5).map((lineValue) => `<div>${escapeHtml(lineValue)}</div>`).join("")}
    </footer>
  `;

  bindEvents();
  drawCanvas();
}

function bindEvents() {
  /** @type {NodeListOf<HTMLButtonElement>} */
  const viewModeButtons = document.querySelectorAll("[data-view-mode]");
  viewModeButtons.forEach((button) => {
    button.addEventListener("click", () => {
      state.viewMode = button.dataset.viewMode;
      state.selectedId = null;
      state.draftPoints = [];
      log(`表示状態: ${viewModeLabel(state.viewMode)}`);
      render();
    });
  });

  document.querySelector("#apiHealthBtn").addEventListener("click", checkApiHealth);

  /** @type {NodeListOf<HTMLButtonElement>} */
  const toolButtons = document.querySelectorAll("[data-tool]");
  toolButtons.forEach((button) => {
    button.addEventListener("click", () => {
      state.tool = button.dataset.tool;
      state.draftPoints = [];
      log(`ツール切替: ${state.tool}`);
      render();
    });
  });

  const roleSelect = /** @type {HTMLSelectElement} */ (document.querySelector("#roleSelect"));
  roleSelect.addEventListener("change", () => {
    state.drawing.currentRole = roleSelect.value;
    persist("権限切替");
  });

  const layerSelect = /** @type {HTMLSelectElement} */ (document.querySelector("#layerSelect"));
  layerSelect.addEventListener("change", () => {
    state.currentLayerId = layerSelect.value;
    log(`現在レイヤー: ${layerName(state.currentLayerId)}`);
    render();
  });

  document.querySelector("#deleteBtn").addEventListener("click", deleteSelected);
  document.querySelector("#fitBtn").addEventListener("click", () => {
    state.camera = { x: 45, y: 45, scale: 0.08 };
    render();
  });
  document.querySelector("#exportBtn").addEventListener("click", () => exportDrawingFile(state.drawing));
  document.querySelector("#resetBtn").addEventListener("click", () => {
    clearDrawing();
    state.drawing = seedDrawing();
    state.selectedId = null;
    state.previewProposal = null;
    state.previewRunId = null;
    state.apiStatus = { state: "idle", message: "未確認", connected: false };
    persist("デモ初期化");
  });

  document.querySelector("#planAiBtn").addEventListener("click", planAiProposal);
  document.querySelector("#applyAiBtn").addEventListener("click", applyAiProposal);

  /** @type {NodeListOf<HTMLInputElement>} */
  const layerVisibilityInputs = document.querySelectorAll("[data-layer-visible]");
  layerVisibilityInputs.forEach((checkbox) => {
    checkbox.addEventListener("change", () => {
      const layer = state.drawing.layers.find((item) => item.id === checkbox.dataset.layerVisible);
      if (!layer) return;
      commitCommands(`レイヤー表示切替: ${layer.name}`, [
        { op: "update_layer", id: layer.id, patch: { visible: checkbox.checked } }
      ]);
    });
  });
  /** @type {NodeListOf<HTMLButtonElement>} */
  const layerLockButtons = document.querySelectorAll("[data-layer-lock]");
  layerLockButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const layer = state.drawing.layers.find((item) => item.id === button.dataset.layerLock);
      if (!layer) return;
      commitCommands(`レイヤーロック切替: ${layer.name}`, [
        { op: "update_layer", id: layer.id, patch: { locked: !layer.locked } }
      ]);
    });
  });

  document.querySelector("#reviewBtn").addEventListener("click", () => changeReviewState("submit"));
  document.querySelector("#approveBtn").addEventListener("click", () => changeReviewState("approve"));
  document.querySelector("#newVersionBtn").addEventListener("click", () => changeReviewState("new_version"));

  const canvas = /** @type {HTMLCanvasElement} */ (document.querySelector("#cadCanvas"));
  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("pointercancel", cancelDrag);
  canvas.addEventListener("lostpointercapture", cancelDrag);
  canvas.addEventListener("wheel", onWheel, { passive: false });
  canvas.addEventListener("keydown", onCanvasKeyDown);
  canvas.focus();
}

async function changeReviewState(action) {
  const policy = ROLE_POLICIES[state.drawing.currentRole] ?? ROLE_POLICIES.viewer;
  const allowed = action === "submit" ? policy.canEdit : policy.canApprove;
  if (!allowed) {
    log(`${policy.label}は${action === "submit" ? "レビュー提出" : "承認・新版作成"}できません。`);
    render();
    return;
  }
  if (action === "submit" && !["draft", "rejected"].includes(state.drawing.state)) {
    log("下書きまたは差戻し図面だけをレビュー提出できます。");
    render();
    return;
  }
  if (action === "new_version" && state.drawing.state !== "approved") {
    log("承認済み図面からのみ新版を作成できます。");
    render();
    return;
  }
  if (state.apiStatus.connected) {
    try {
      const body = await apiRequest(`/api/drawings/${state.drawing.id}/review`, {
        method: "POST",
        headers: transactionHeaders(),
        body: JSON.stringify({ action })
      });
      state.drawing = body.drawing;
      persist({ submit: "レビュー提出", approve: "承認完了", new_version: "新版作成" }[action]);
    } catch (error) {
      log(`API操作失敗: ${errorMessage(error)}`);
      render();
    }
    return;
  }

  if (action === "submit") {
    state.drawing = submitForReview(state.drawing, state.drawing.currentRole);
    persist("レビュー提出");
  }
  if (action === "approve") {
    const result = approveDrawing(state.drawing, state.drawing.currentRole);
    if (!result.ok) {
      log(`承認失敗: ${result.error}`);
      render();
      return;
    }
    state.drawing = result.drawing;
    persist("承認完了");
  }
  if (action === "new_version") {
    state.drawing = createNewVersion(state.drawing, state.drawing.currentRole);
    persist("新版作成");
  }
}

function onPointerDown(event) {
  if (state.viewMode === "loading" || state.viewMode === "error") {
    log(`${viewModeLabel(state.viewMode)}状態ではCanvas操作を停止しています。`);
    render();
    return;
  }
  const world = screenToWorld(event.offsetX, event.offsetY);
  const policy = ROLE_POLICIES[state.drawing.currentRole] ?? ROLE_POLICIES.viewer;

  if (state.tool === "select") {
    const hit = hitTest(activeDrawing(), world);
    state.selectedId = hit?.id ?? null;
    state.drag = hit && policy.canEdit ? { id: hit.id, start: world, original: structuredClone(hit) } : null;
    if (state.drag) /** @type {HTMLCanvasElement} */ (event.currentTarget).setPointerCapture(event.pointerId);
    log(hit ? `選択: ${hit.id}` : "選択解除");
    render();
    return;
  }

  if (!policy.canEdit) {
    log(`${policy.label}は作図できません。`);
    render();
    return;
  }

  if (state.tool === "line" || state.tool === "rect" || state.tool === "circle") {
    state.draftPoints.push(world);
    if (state.draftPoints.length === 2) {
      commitTwoPointTool();
    } else {
      drawCanvas(world);
    }
  }

  if (state.tool === "polyline") {
    state.draftPoints.push(world);
    drawCanvas(world);
  }

  if (state.tool === "text") {
    const value = prompt("配置する文字を入力", "施工注記");
    if (value) {
      commitCommands("文字追加", [{ op: "add", entity: text(state.currentLayerId, [world.x, world.y], value) }]);
    }
  }
}

function onPointerMove(event) {
  const world = screenToWorld(event.offsetX, event.offsetY);
  if (state.drag) {
    const dx = world.x - state.drag.start.x;
    const dy = world.y - state.drag.start.y;
    const entity = moveEntity(state.drag.original, dx, dy);
    const index = state.drawing.entities.findIndex((item) => item.id === state.drag.id);
    state.drawing.entities[index] = entity;
    drawCanvas();
    return;
  }
  if (state.draftPoints.length > 0) {
    drawCanvas(world);
  }
}

function onPointerUp() {
  if (!state.drag) return;
  const entity = state.drawing.entities.find((item) => item.id === state.drag.id);
  state.drawing.entities = state.drawing.entities.map((item) => (item.id === state.drag.id ? state.drag.original : item));
  const command = { op: "update", id: state.drag.id, patch: withoutIdentity(entity) };
  state.drag = null;
  commitCommands("図形移動", [command]);
}

function cancelDrag() {
  if (!state.drag) return;
  state.drawing.entities = state.drawing.entities.map((item) =>
    item.id === state.drag.id ? state.drag.original : item
  );
  state.drag = null;
  log("図形移動を取消");
  render();
}

function onWheel(event) {
  event.preventDefault();
  const factor = event.deltaY < 0 ? 1.12 : 0.9;
  const before = screenToWorld(event.offsetX, event.offsetY);
  state.camera.scale = Math.min(0.5, Math.max(0.025, state.camera.scale * factor));
  const after = screenToWorld(event.offsetX, event.offsetY);
  state.camera.x += (after.x - before.x) * state.camera.scale;
  state.camera.y += (after.y - before.y) * state.camera.scale;
  drawCanvas();
}

function onCanvasKeyDown(event) {
  if (event.key === "Escape") {
    state.draftPoints = [];
    state.selectedId = null;
    log("取消");
    render();
  }
  if (event.key === "Enter" && state.tool === "polyline" && state.draftPoints.length >= 3) {
    commitCommands("ポリライン作成", [
      { op: "add", entity: polyline(state.currentLayerId, state.draftPoints, { closed: event.shiftKey }) }
    ]);
    state.draftPoints = [];
  }
  if ((event.key === "Delete" || event.key === "Backspace") && state.selectedId) {
    deleteSelected();
  }
}

function commitTwoPointTool() {
  const [a, b] = state.draftPoints;
  const commands = [];
  if (state.tool === "line") {
    commands.push({ op: "add", entity: line(state.currentLayerId, [a.x, a.y], [b.x, b.y]) });
  }
  if (state.tool === "rect") {
    commands.push({ op: "add", entity: rect(state.currentLayerId, [a.x, a.y], b.x - a.x, b.y - a.y) });
  }
  if (state.tool === "circle") {
    commands.push({ op: "add", entity: circle(state.currentLayerId, [a.x, a.y], Math.hypot(b.x - a.x, b.y - a.y)) });
  }
  commitCommands(`${state.tool}作成`, commands);
  state.draftPoints = [];
}

function deleteSelected() {
  if (!state.selectedId) {
    log("削除対象が未選択です。");
    render();
    return;
  }
  commitCommands("図形削除", [{ op: "delete", id: state.selectedId }]);
  state.selectedId = null;
}

async function planAiProposal() {
  const promptInput = /** @type {HTMLTextAreaElement} */ (document.querySelector("#aiPrompt"));
  const promptValue = promptInput.value;
  if (state.apiStatus.connected) {
    try {
      const body = await apiRequest(`/api/drawings/${state.drawing.id}/agent-runs`, {
        method: "POST",
        body: JSON.stringify({ prompt: promptValue })
      });
      state.previewProposal = body.run.proposal;
      state.previewRunId = body.run.id;
    } catch (error) {
      log(`AI Preview失敗: ${errorMessage(error)}`);
      render();
      return;
    }
  } else {
    state.previewProposal = buildAiProposal(state.drawing, promptValue);
    state.previewRunId = null;
  }
  log(state.previewProposal.status === "planned" ? `AI Preview生成: ${state.previewProposal.label}` : "AI追加入力が必要");
  render();
}

async function applyAiProposal() {
  const policy = ROLE_POLICIES[state.drawing.currentRole] ?? ROLE_POLICIES.viewer;
  if (!policy.canRunAi && !policy.canEdit) {
    log(`${policy.label}はAI提案を適用できません。`);
    render();
    return;
  }

  if (state.apiStatus.connected && state.previewRunId) {
    try {
      const body = await apiRequest(`/api/agent-runs/${state.previewRunId}/approve`, {
        method: "POST",
        headers: transactionHeaders(),
        body: JSON.stringify({ drawingId: state.drawing.id, proposal: state.previewProposal })
      });
      state.drawing = body.drawing;
      state.previewProposal = null;
      state.previewRunId = null;
      persist("AI提案を承認適用 / Neon同期");
    } catch (error) {
      log(`AI適用失敗: ${errorMessage(error)}`);
      render();
    }
    return;
  }

  const result = applyTransaction(state.drawing, proposalToTransaction(state.previewProposal, state.drawing.currentRole));
  if (!result.ok) {
    log(`AI適用失敗: ${result.error}`);
    render();
    return;
  }
  state.drawing = result.drawing;
  state.previewProposal = null;
  persist("AI提案を承認適用");
}

async function commitCommands(label, commands) {
  if (state.apiStatus.connected) {
    try {
      const body = await apiRequest(`/api/drawings/${state.drawing.id}/transactions`, {
        method: "POST",
        headers: transactionHeaders(),
        body: JSON.stringify({ label, commands })
      });
      state.drawing = body.drawing;
      persist(`${label} / Neon同期`);
    } catch (error) {
      log(`${label}失敗: ${errorMessage(error)}`);
      render();
    }
    return;
  }

  const result = applyTransaction(state.drawing, {
    source: "user",
    actor: state.drawing.currentRole,
    label,
    commands
  });
  if (!result.ok) {
    log(`${label}失敗: ${result.error}`);
    render();
    return;
  }
  state.drawing = result.drawing;
  persist(label);
}

function drawCanvas(pointerWorld = null) {
  const canvas = /** @type {HTMLCanvasElement | null} */ (document.querySelector("#cadCanvas"));
  if (!canvas) return;
  const drawing = activeDrawing();
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawGrid(ctx, canvas);
  drawPaper(ctx);

  for (const entity of drawing.entities) {
    drawEntity(ctx, entity, entity.id === state.selectedId ? "#ff8a00" : null);
  }

  if (state.previewProposal?.status === "planned") {
    for (const command of state.previewProposal.commands) {
      if (command.op === "add") drawEntity(ctx, command.entity, "#18b6c9", true);
    }
  }

  if (state.draftPoints.length > 0 && pointerWorld) {
    ctx.save();
    ctx.strokeStyle = "#ff8a00";
    ctx.setLineDash([8, 6]);
    const points = [...state.draftPoints, pointerWorld];
    ctx.beginPath();
    const first = worldToScreen(points[0]);
    ctx.moveTo(first.x, first.y);
    for (const pointValue of points.slice(1)) {
      const screen = worldToScreen(pointValue);
      ctx.lineTo(screen.x, screen.y);
    }
    ctx.stroke();
    ctx.restore();
  }

  if (state.viewMode === "loading" || state.viewMode === "error" || state.viewMode === "empty") {
    drawStateOverlay(ctx, canvas, state.viewMode);
  }
}

function drawGrid(ctx, canvas) {
  ctx.save();
  ctx.fillStyle = "#f8fbfd";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = "#e4edf3";
  ctx.lineWidth = 1;
  const step = 500 * state.camera.scale;
  for (let x = state.camera.x % step; x < canvas.width; x += step) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, canvas.height);
    ctx.stroke();
  }
  for (let y = state.camera.y % step; y < canvas.height; y += step) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(canvas.width, y);
    ctx.stroke();
  }
  ctx.restore();
}

function drawPaper(ctx) {
  const a = worldToScreen({ x: 0, y: 0 });
  const b = worldToScreen({ x: 12000, y: 7000 });
  ctx.save();
  ctx.fillStyle = "#ffffff";
  ctx.strokeStyle = "#bfd0dc";
  ctx.lineWidth = 2;
  ctx.fillRect(a.x, a.y, b.x - a.x, b.y - a.y);
  ctx.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y);
  ctx.restore();
}

function drawEntity(ctx, entity, overrideColor = null, preview = false) {
  const layer = activeDrawing().layers.find((item) => item.id === entity.layerId);
  if (!layer?.visible) return;
  ctx.save();
  ctx.strokeStyle = overrideColor ?? layer.color;
  ctx.fillStyle = entity.style?.fill === "transparent" ? "transparent" : entity.style?.fill ?? "transparent";
  ctx.lineWidth = preview ? 3 : entity.style?.strokeWidth ?? 2;
  ctx.setLineDash(overrideColor ? [8, 6] : entity.style?.lineDash ?? []);

  if (entity.type === "line") {
    const [a, b] = entity.points.map(worldToScreen);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }
  if (entity.type === "rect") {
    const a = worldToScreen(entity.origin);
    ctx.strokeRect(a.x, a.y, entity.width * state.camera.scale, entity.height * state.camera.scale);
  }
  if (entity.type === "circle") {
    const center = worldToScreen(entity.center);
    ctx.beginPath();
    ctx.arc(center.x, center.y, entity.radius * state.camera.scale, 0, Math.PI * 2);
    ctx.stroke();
  }
  if (entity.type === "polyline") {
    const points = entity.points.map(worldToScreen);
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (const pointValue of points.slice(1)) ctx.lineTo(pointValue.x, pointValue.y);
    if (entity.closed) ctx.closePath();
    ctx.stroke();
  }
  if (entity.type === "text") {
    const at = worldToScreen(entity.at);
    ctx.fillStyle = overrideColor ?? layer.color;
    ctx.font = `${Math.max(11, entity.size * state.camera.scale)}px sans-serif`;
    ctx.fillText(entity.value, at.x, at.y);
  }
  ctx.restore();
}

function moveEntity(entity, dx, dy) {
  const next = structuredClone(entity);
  if (next.points) next.points = next.points.map((pointValue) => ({ x: pointValue.x + dx, y: pointValue.y + dy }));
  if (next.origin) next.origin = { x: next.origin.x + dx, y: next.origin.y + dy };
  if (next.center) next.center = { x: next.center.x + dx, y: next.center.y + dy };
  if (next.at) next.at = { x: next.at.x + dx, y: next.at.y + dy };
  return next;
}

function worldToScreen(point) {
  return {
    x: state.camera.x + point.x * state.camera.scale,
    y: state.camera.y + point.y * state.camera.scale
  };
}

function screenToWorld(x, y) {
  return {
    x: (x - state.camera.x) / state.camera.scale,
    y: (y - state.camera.y) / state.camera.scale
  };
}

function persist(message) {
  saveDrawing(state.drawing);
  log(message);
  render();
}

async function checkApiHealth() {
  state.apiStatus = { state: "loading", message: "確認中", connected: false };
  render();
  try {
    const body = await apiRequest("/api/health");
    const drawingBody = await apiRequest("/api/drawings/demo");
    const selectedRole = state.drawing.currentRole;
    state.drawing = { ...drawingBody.drawing, currentRole: selectedRole };
    saveDrawing(state.drawing);
    state.apiStatus = {
      state: "ok",
      message: `${body.service} / auth=${body.auth.mode} / db=${body.db.mode} / 同期済み`,
      connected: true
    };
  } catch (error) {
    state.apiStatus = { state: "error", message: `API未接続: ${errorMessage(error)}`, connected: false };
  }
  render();
}

async function apiRequest(pathname, options = {}) {
  const response = await fetch(pathname, {
    ...options,
    headers: {
      "content-type": "application/json",
      "x-demo-role": state.drawing.currentRole,
      ...options.headers
    }
  });
  const body = await response.json();
  if (!response.ok || !body.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
  return body;
}

function transactionHeaders() {
  return {
    "idempotency-key": globalThis.crypto?.randomUUID?.() ?? `web-${Date.now()}`,
    "expected-version": String(state.drawing.revision ?? 1)
  };
}

function log(message) {
  state.commandLog.push(`${new Date().toLocaleTimeString("ja-JP")} ${message}`);
}

function toolButton(tool, icon, label) {
  return `<button data-tool="${tool}" class="icon-button ${state.tool === tool ? "active" : ""}" title="${label}" aria-label="${label}">${icon}</button>`;
}

function stateButton(mode, label) {
  return `<button data-view-mode="${mode}" class="${state.viewMode === mode ? "active" : ""}" aria-pressed="${
    state.viewMode === mode
  }">${label}</button>`;
}

function stateLabel(value) {
  return {
    draft: "下書き",
    in_review: "レビュー中",
    approved: "承認済み",
    rejected: "差戻し"
  }[value] ?? value;
}

function layerName(layerId) {
  return state.drawing.layers.find((layer) => layer.id === layerId)?.name ?? layerId;
}

function activeDrawing() {
  if (state.viewMode === "empty") {
    return createDrawing({
      id: "dwg_empty_preview",
      name: "空状態確認",
      currentRole: state.drawing.currentRole,
      layers: structuredClone(state.drawing.layers),
      entities: [],
      commandEvents: [],
      auditLog: []
    });
  }
  return state.drawing;
}

function viewModeLabel(mode) {
  return {
    normal: "正常",
    empty: "空",
    loading: "Loading",
    error: "Error"
  }[mode] ?? mode;
}

function drawStateOverlay(ctx, canvas, mode) {
  const labels = {
    empty: ["空の図面", "新規作成直後の状態です"],
    loading: ["Loading", "図面データを取得しています"],
    error: ["Error", "APIまたは図面読込に失敗した状態です"]
  };
  const [title, subtitle] = labels[mode] ?? labels.empty;
  ctx.save();
  ctx.fillStyle = "rgba(255, 255, 255, 0.86)";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = mode === "error" ? "#be3c3c" : "#10253c";
  ctx.textAlign = "center";
  ctx.font = "700 28px sans-serif";
  ctx.fillText(title, canvas.width / 2, canvas.height / 2 - 12);
  ctx.fillStyle = "#5f7182";
  ctx.font = "16px sans-serif";
  ctx.fillText(subtitle, canvas.width / 2, canvas.height / 2 + 22);
  ctx.restore();
}

function proposalHtml() {
  const proposal = state.previewProposal;
  if (!proposal) return "<p>AI提案はまだありません。Previewで差分を生成します。</p>";
  if (proposal.status === "needs_input") return `<p class="warn">${escapeHtml(proposal.question)}</p>`;
  return `
    <dl>
      <dt>Skill</dt><dd>${escapeHtml(proposal.skill.id)}@${escapeHtml(proposal.skill.version)}</dd>
      <dt>Impact</dt><dd>追加 ${escapeHtml(proposal.impact.add)} / 更新 ${escapeHtml(proposal.impact.update)} / 削除 ${escapeHtml(
        proposal.impact.delete
      )}</dd>
      <dt>Gate</dt><dd>${escapeHtml(proposal.postconditions.join(", "))}</dd>
    </dl>
    ${proposal.warnings.map((warning) => `<p class="warn">${escapeHtml(warning)}</p>`).join("")}
  `;
}

function inspectionHtml() {
  const issues = validateDrawing(activeDrawing());
  if (issues.length === 0) return '<p class="ok">検査OK: Critical/Highなし</p>';
  return `
    <ul class="issue-list">
      ${issues
        .map((issue) => `<li class="${issue.severity}"><b>${issue.severity}</b> ${escapeHtml(issue.message)}</li>`)
        .join("")}
    </ul>
  `;
}

function quantityHtml() {
  const value = measurements(activeDrawing());
  return `
    <dl>
      <dt>図形数</dt><dd>${value.entityCount}</dd>
      <dt>総延長</dt><dd>${value.totalLength.toLocaleString()} mm</dd>
      <dt>面積</dt><dd>${value.totalArea.toLocaleString()} mm²</dd>
    </dl>
  `;
}

function withoutIdentity(entity) {
  const { id, ...rest } = entity;
  return rest;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function safeColor(value) {
  return /^#[0-9a-f]{6}$/i.test(String(value)) ? String(value) : "#5b6b7a";
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

render();
