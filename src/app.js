import {
  ROLE_POLICIES,
  applyTransaction,
  approveDrawing,
  buildAiProposal,
  createDrawing,
  circle,
  createNewVersion,
  entityBounds,
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
import { parseCadCommand } from "./cad-command.js";
import { parseCadImport } from "./importers.js";
import { clearDrawing, exportDrawingFile, loadDrawing, saveDrawing } from "./storage.js";
import { blockEntity, dimensionEntity, editLineEndpoint, hatchEntity, measurePoints, offsetEntity, transformEntity } from "./cad-advanced.js";

const VIEW_MODES = new Set(["normal", "empty", "loading", "error"]);
const requestedViewMode = new URLSearchParams(location.search).get("state") ?? "normal";
const USER_SETTINGS_KEY = "mirai-web-cad-settings";
const GRID_INTERVALS = new Set([100, 250, 500, 1000]);
const RAIL_WIDTH_MIN = 72;
const RAIL_WIDTH_MAX = 180;
const DEFAULT_USER_SETTINGS = Object.freeze({
  showGrid: true,
  snapEnabled: false,
  gridInterval: 500,
  commandLogLines: 2,
  dimensionOffset: 350,
  dimensionPrecision: 0,
  dimensionSuffix: "",
  railWidth: 76
});

const state = {
  drawing: loadDrawing() ?? seedDrawing(),
  tool: "select",
  currentLayerId: "layer-structure",
  selectedId: null,
  draftPoints: [],
  previewProposal: null,
  previewRunId: null,
  camera: { x: 50, y: 40, scale: 0.075 },
  commandLog: ["起動: Mirai Web CAD"],
  commandHistory: [],
  commandHistoryIndex: 0,
  undoStack: [],
  redoStack: [],
  focusTarget: null,
  drag: null,
  panStart: null,
  measurement: null,
  viewMode: VIEW_MODES.has(requestedViewMode) ? requestedViewMode : "normal",
  apiStatus: { state: "idle", message: "未確認", connected: false, roleLocked: false },
  settings: loadUserSettings()
};

const app = document.querySelector("#app");

function render() {
  const drawing = activeDrawing();
  const selected = drawing.entities.find((entity) => entity.id === state.selectedId);
  const commandLogClass = `command-log-${state.settings.commandLogLines}`;
  app.className = `app-shell ${commandLogClass}`;
  app.innerHTML = `
    <header class="topbar">
      <div>
        <p class="eyebrow">CIVIL ENGINEERING 2D CAD</p>
        <h1>Mirai Web CAD</h1>
      </div>
      <div class="topbar-actions">
        <div class="drawing-meta" aria-label="図面状態">
          <strong>${escapeHtml(drawing.name)}</strong>
          <span>v${escapeHtml(drawing.version)}</span>
          <span>${escapeHtml(stateLabel(drawing.state))}</span>
          <label>
            権限
            <select id="roleSelect" aria-label="権限を切替" ${state.apiStatus.roleLocked ? "disabled" : ""}>
              ${Object.entries(ROLE_POLICIES)
                .map(
                  ([role, policy]) =>
                    `<option value="${role}" ${state.drawing.currentRole === role ? "selected" : ""}>${policy.label}</option>`
                )
                .join("")}
            </select>
          </label>
        </div>
        <button id="settingsBtn" class="topbar-command" type="button" title="システム設定" aria-label="システム設定">
          <span aria-hidden="true">⚙</span><span>設定</span>
        </button>
      </div>
    </header>

    <main class="workspace" style="--rail-width: ${state.settings.railWidth}px">
      <aside class="rail" aria-label="作図ツール">
        <div class="section-title">File</div>
        <button id="newDrawingBtn" class="icon-button" title="新規図面" aria-label="新規図面">＋</button>
        <button id="importBtn" class="icon-button" title="JSONまたはDXFをImport" aria-label="Import">⇧</button>
        <input id="importFile" type="file" accept=".json,.dxf,application/json" hidden />
        <div class="section-title">Draw</div>
        ${toolButton("select", "↖", "選択")}
        ${toolButton("line", "／", "線")}
        ${toolButton("rect", "□", "矩形")}
        ${toolButton("circle", "○", "円")}
        ${toolButton("polyline", "⌁", "ポリライン")}
        ${toolButton("text", "T", "文字")}
        ${toolButton("dimension", "↔", "寸法線")}
        ${toolButton("hatch", "▧", "ハッチング")}
        ${toolButton("measure", "⌖", "計測")}
        ${toolButton("pan", "✥", "パン")}
        <div class="section-title">Edit</div>
        <button id="undoBtn" class="icon-button" title="元に戻す" aria-label="元に戻す" ${state.undoStack.length ? "" : "disabled"}>↶</button>
        <button id="redoBtn" class="icon-button" title="やり直す" aria-label="やり直す" ${state.redoStack.length ? "" : "disabled"}>↷</button>
        <button id="deleteBtn" class="icon-button" title="削除" aria-label="選択図形を削除">⌫</button>
        <button id="fitBtn" class="icon-button" title="図面範囲表示" aria-label="図面範囲表示">⛶</button>
        <button id="zoomInBtn" class="icon-button" title="拡大" aria-label="拡大">＋</button>
        <button id="zoomOutBtn" class="icon-button" title="縮小" aria-label="縮小">−</button>
        <button id="exportBtn" class="icon-button" title="JSON出力" aria-label="JSON出力">⇩</button>
        <button id="resetBtn" class="icon-button danger" title="デモ初期化" aria-label="デモ初期化">↺</button>
      </aside>
      <div
        id="railResizeHandle"
        class="rail-resize-handle"
        role="separator"
        aria-label="左サイドメニュー幅を調整"
        aria-orientation="vertical"
        aria-valuemin="${RAIL_WIDTH_MIN}"
        aria-valuemax="${RAIL_WIDTH_MAX}"
        aria-valuenow="${state.settings.railWidth}"
        tabindex="0"
        title="ドラッグまたは左右キーで幅を調整。ダブルクリックで初期化"
      ><span aria-hidden="true">⋮</span></div>

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
          <span>SNAP: ${state.settings.snapEnabled ? `${state.settings.gridInterval} ${drawing.unit}` : "OFF"}</span>
          <span>ZOOM: ${Math.round(state.camera.scale * 1000)}%</span>
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
          <h2>CAD Operations</h2>
          <form id="operationForm" class="compact-form">
            <label>操作
              <select name="operation" aria-label="図形操作">
                <option value="move">移動</option><option value="copy">複写</option>
                <option value="rotate">回転</option><option value="scale">尺度変更</option>
                <option value="offset">オフセット</option><option value="trim">トリム</option>
                <option value="extend">延長</option><option value="block">ブロック化</option>
              </select>
            </label>
            <label>値<input name="value" aria-label="操作値" placeholder="例: 500,0 / 45 / 1.5" /></label>
            <button type="submit" ${selected ? "" : "disabled"}>選択図形へ適用</button>
          </form>
          <p class="measure-result">${state.measurement ? `距離 ${formatNumber(state.measurement.distance)} / ΔX ${formatNumber(state.measurement.dx)} / ΔY ${formatNumber(state.measurement.dy)} / ${formatNumber(state.measurement.angle)}°` : "計測結果なし"}</p>
        </section>

        <section>
          <h2>Properties</h2>
          ${selected ? `
            <form id="propertyForm" class="compact-form">
              <dl><dt>ID</dt><dd>${escapeHtml(selected.id)}</dd><dt>種類</dt><dd>${escapeHtml(selected.type)}</dd></dl>
              <label>レイヤー<select name="layerId">${drawing.layers.map((layer) => `<option value="${escapeHtml(layer.id)}" ${selected.layerId === layer.id ? "selected" : ""}>${escapeHtml(layer.name)}</option>`).join("")}</select></label>
              <label>線幅<input name="strokeWidth" type="number" min="0.5" max="20" step="0.5" value="${escapeHtml(selected.style?.strokeWidth ?? 2)}" /></label>
              ${selected.type === "block" ? `<label>ブロック属性<input name="blockAttributes" value="${escapeHtml(Object.entries(selected.attributes ?? {}).map(([key, value]) => `${key}=${value}`).join(";"))}" placeholder="番号=1;種別=桝" /></label>` : ""}
              <button type="submit">プロパティ更新</button>
            </form>` : `<p class="empty-note">図形を選択してください。</p>`}
        </section>

        <section>
          <h2>Layers</h2>
          <form id="layerForm" class="layer-create-form">
            <input name="name" maxlength="80" placeholder="新規レイヤー名" aria-label="新規レイヤー名" required />
            <input name="color" type="color" value="#246b9f" aria-label="新規レイヤー色" />
            <button type="submit" title="レイヤー追加" aria-label="レイヤー追加">＋</button>
          </form>
          <div class="layer-list">
            ${drawing.layers
              .map(
                (layer) => `
                  <label class="layer-row">
                    <input type="checkbox" data-layer-visible="${escapeHtml(layer.id)}" ${layer.visible ? "checked" : ""} />
                    <input class="swatch" data-layer-color="${escapeHtml(layer.id)}" type="color" value="${safeColor(layer.color)}" aria-label="${escapeHtml(layer.name)}の色" />
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
          <h2>Layout / Print</h2>
          <form id="layoutForm" class="compact-form">
            <div class="inline-fields">
              <label>用紙<select name="paper">${["A4", "A3", "A2", "A1"].map((paper) => `<option ${drawing.layout?.paper === paper ? "selected" : ""}>${paper}</option>`).join("")}</select></label>
              <label>方向<select name="orientation"><option value="landscape" ${drawing.layout?.orientation !== "portrait" ? "selected" : ""}>横</option><option value="portrait" ${drawing.layout?.orientation === "portrait" ? "selected" : ""}>縦</option></select></label>
            </div>
            <div class="inline-fields">
              <label>縮尺 1:<input name="scale" type="number" min="1" value="${escapeHtml(drawing.layout?.scale ?? 100)}" /></label>
              <label>余白 mm<input name="margin" type="number" min="0" value="${escapeHtml(drawing.layout?.margin ?? 10)}" /></label>
            </div>
            <label>表題<input name="title" maxlength="100" value="${escapeHtml(drawing.layout?.title ?? drawing.name)}" /></label>
            <div class="button-row"><button type="submit">設定保存</button><button id="printBtn" type="button">PDF / 印刷</button></div>
          </form>
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

    <footer class="command-line ${commandLogClass}" aria-label="コマンドライン">
      <div class="command-history" aria-label="コマンドログ" aria-live="polite" tabindex="0">
        ${state.commandLog
          .slice(-state.settings.commandLogLines)
          .map((lineValue) => `<div>${escapeHtml(lineValue)}</div>`)
          .join("")}
      </div>
      <form id="commandForm" class="command-form">
        <span aria-hidden="true">&gt;</span>
        <input id="commandInput" type="text" autocomplete="off" spellcheck="false" placeholder="Command" aria-label="コマンド入力" />
        <button type="submit" title="コマンド実行" aria-label="コマンド実行">↵</button>
      </form>
    </footer>

    <dialog id="newDrawingDialog" aria-labelledby="newDrawingTitle">
      <form id="newDrawingForm" method="dialog">
        <header>
          <h2 id="newDrawingTitle">新規図面</h2>
          <button id="closeNewDrawingBtn" type="button" class="dialog-close" aria-label="閉じる" title="閉じる">×</button>
        </header>
        <label>図面名<input id="newDrawingName" name="name" maxlength="100" required value="新規図面" /></label>
        <label>単位<select name="unit"><option value="mm">mm</option><option value="m">m</option></select></label>
        <label>テンプレート<select name="template"><option value="blank">空図面</option><option value="demo">デモ施工図</option></select></label>
        <div class="dialog-actions">
          <button id="cancelNewDrawingBtn" type="button">キャンセル</button>
          <button type="submit" class="primary">作成</button>
        </div>
      </form>
    </dialog>

    <dialog id="settingsDialog" aria-labelledby="settingsTitle">
      <form id="settingsForm" method="dialog">
        <header>
          <h2 id="settingsTitle">システム設定</h2>
          <button id="closeSettingsBtn" type="button" class="dialog-close" aria-label="閉じる" title="閉じる">×</button>
        </header>
        <fieldset class="settings-group">
          <legend>作図補助</legend>
          <label class="toggle-row">
            <input name="showGrid" type="checkbox" ${state.settings.showGrid ? "checked" : ""} />
            <span>グリッド表示</span>
          </label>
          <label class="toggle-row">
            <input name="snapEnabled" type="checkbox" ${state.settings.snapEnabled ? "checked" : ""} />
            <span>グリッドスナップ</span>
          </label>
          <label>
            グリッド間隔
            <select name="gridInterval">
              ${[100, 250, 500, 1000]
                .map(
                  (interval) =>
                    `<option value="${interval}" ${state.settings.gridInterval === interval ? "selected" : ""}>${interval} ${escapeHtml(
                      drawing.unit
                    )}</option>`
                )
                .join("")}
            </select>
          </label>
        </fieldset>
        <fieldset class="settings-group">
          <legend>寸法スタイル</legend>
          <label>寸法線オフセット<input name="dimensionOffset" type="number" min="0" value="${escapeHtml(state.settings.dimensionOffset)}" /></label>
          <label>小数桁<select name="dimensionPrecision">${[0, 1, 2, 3].map((value) => `<option value="${value}" ${state.settings.dimensionPrecision === value ? "selected" : ""}>${value}</option>`).join("")}</select></label>
          <label>接尾辞<input name="dimensionSuffix" maxlength="12" value="${escapeHtml(state.settings.dimensionSuffix)}" placeholder="例: mm" /></label>
        </fieldset>
        <fieldset class="settings-group">
          <legend>画面</legend>
          <label>
            ログ表示行数
            <select name="commandLogLines">
              ${[1, 2, 3]
                .map(
                  (lines) => `<option value="${lines}" ${state.settings.commandLogLines === lines ? "selected" : ""}>${lines}行</option>`
                )
                .join("")}
            </select>
          </label>
        </fieldset>
        <dl class="system-summary">
          <dt>保存先</dt><dd>このブラウザ</dd>
          <dt>API</dt><dd>${escapeHtml(state.apiStatus.connected ? "接続済み" : "未確認")}</dd>
          <dt>バージョン</dt><dd>0.1.0</dd>
        </dl>
        <div class="dialog-actions settings-actions">
          <button id="resetSettingsBtn" type="button">初期値</button>
          <span></span>
          <button id="cancelSettingsBtn" type="button">キャンセル</button>
          <button type="submit" class="primary">適用</button>
        </div>
      </form>
    </dialog>
  `;

  bindEvents();
  drawCanvas();
}

function bindEvents() {
  const newDrawingDialog = /** @type {HTMLDialogElement} */ (document.querySelector("#newDrawingDialog"));
  const settingsDialog = /** @type {HTMLDialogElement} */ (document.querySelector("#settingsDialog"));
  const importFile = /** @type {HTMLInputElement} */ (document.querySelector("#importFile"));
  document.querySelector("#newDrawingBtn").addEventListener("click", () => openNewDrawingDialog());
  document.querySelector("#importBtn").addEventListener("click", () => importFile.click());
  importFile.addEventListener("change", handleImportFile);
  document.querySelector("#newDrawingForm").addEventListener("submit", createNewDrawingFromForm);
  document.querySelector("#closeNewDrawingBtn").addEventListener("click", () => newDrawingDialog.close());
  document.querySelector("#cancelNewDrawingBtn").addEventListener("click", () => newDrawingDialog.close());
  document.querySelector("#settingsBtn").addEventListener("click", () => settingsDialog.showModal());
  document.querySelector("#settingsForm").addEventListener("submit", saveSettingsFromForm);
  document.querySelector("#closeSettingsBtn").addEventListener("click", () => settingsDialog.close());
  document.querySelector("#cancelSettingsBtn").addEventListener("click", () => settingsDialog.close());
  document.querySelector("#resetSettingsBtn").addEventListener("click", resetUserSettings);
  bindRailResize();

  const commandForm = /** @type {HTMLFormElement} */ (document.querySelector("#commandForm"));
  const commandInput = /** @type {HTMLInputElement} */ (document.querySelector("#commandInput"));
  commandForm.addEventListener("submit", executeCommandLine);
  commandInput.addEventListener("keydown", navigateCommandHistory);

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
  document.querySelector("#undoBtn").addEventListener("click", undoLastTransaction);
  document.querySelector("#redoBtn").addEventListener("click", redoLastTransaction);
  document.querySelector("#fitBtn").addEventListener("click", fitToDrawing);
  document.querySelector("#zoomInBtn").addEventListener("click", () => zoomAtCenter(1.25));
  document.querySelector("#zoomOutBtn").addEventListener("click", () => zoomAtCenter(0.8));
  document.querySelector("#exportBtn").addEventListener("click", () => exportDrawingFile(state.drawing));
  document.querySelector("#resetBtn").addEventListener("click", () => {
    clearDrawing();
    state.drawing = seedDrawing();
    resetAuthoringState();
    fitCameraToDrawing();
    state.apiStatus = { state: "idle", message: "未確認", connected: false, roleLocked: false };
    persist("デモ初期化");
  });

  document.querySelector("#planAiBtn").addEventListener("click", planAiProposal);
  document.querySelector("#applyAiBtn").addEventListener("click", applyAiProposal);
  document.querySelector("#operationForm").addEventListener("submit", applyOperationForm);
  document.querySelector("#propertyForm")?.addEventListener("submit", updateSelectedProperties);
  document.querySelector("#layerForm").addEventListener("submit", createLayerFromForm);
  document.querySelector("#layoutForm").addEventListener("submit", updateLayoutFromForm);
  document.querySelector("#printBtn").addEventListener("click", printDrawing);

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
  document.querySelectorAll("[data-layer-color]").forEach((input) => {
    const colorInput = /** @type {HTMLInputElement} */ (input);
    colorInput.addEventListener("change", () => commitCommands("レイヤー色変更", [
      { op: "update_layer", id: colorInput.dataset.layerColor, patch: { color: colorInput.value } }
    ]));
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
  if (state.focusTarget === "command") commandInput.focus({ preventScroll: true });
  else canvas.focus({ preventScroll: true });
  state.focusTarget = null;
}

function openNewDrawingDialog(name = "") {
  const dialog = /** @type {HTMLDialogElement} */ (document.querySelector("#newDrawingDialog"));
  const input = /** @type {HTMLInputElement} */ (document.querySelector("#newDrawingName"));
  if (name) input.value = name;
  dialog.showModal();
  input.select();
}

function saveSettingsFromForm(event) {
  event.preventDefault();
  const form = /** @type {HTMLFormElement} */ (event.currentTarget);
  const data = new FormData(form);
  const gridInterval = Number(data.get("gridInterval"));
  const commandLogLines = Number(data.get("commandLogLines"));
  const dimensionOffset = Number(data.get("dimensionOffset"));
  const dimensionPrecision = Number(data.get("dimensionPrecision"));
  state.settings = {
    showGrid: data.get("showGrid") === "on",
    snapEnabled: data.get("snapEnabled") === "on",
    gridInterval: GRID_INTERVALS.has(gridInterval) ? gridInterval : DEFAULT_USER_SETTINGS.gridInterval,
    commandLogLines: [1, 2, 3].includes(commandLogLines) ? commandLogLines : DEFAULT_USER_SETTINGS.commandLogLines,
    dimensionOffset: Number.isFinite(dimensionOffset) && dimensionOffset >= 0 ? dimensionOffset : DEFAULT_USER_SETTINGS.dimensionOffset,
    dimensionPrecision: [0, 1, 2, 3].includes(dimensionPrecision) ? dimensionPrecision : DEFAULT_USER_SETTINGS.dimensionPrecision,
    dimensionSuffix: String(data.get("dimensionSuffix") ?? "").slice(0, 12),
    railWidth: state.settings.railWidth
  };
  saveUserSettings();
  log("システム設定を更新");
  /** @type {HTMLDialogElement} */ (document.querySelector("#settingsDialog")).close();
  render();
}

function resetUserSettings() {
  state.settings = { ...DEFAULT_USER_SETTINGS };
  saveUserSettings();
  log("システム設定を初期化");
  /** @type {HTMLDialogElement} */ (document.querySelector("#settingsDialog")).close();
  render();
}

function bindRailResize() {
  const handle = /** @type {HTMLElement} */ (document.querySelector("#railResizeHandle"));
  const workspace = /** @type {HTMLElement} */ (document.querySelector(".workspace"));
  let dragStart = null;

  const applyWidth = (width, persist = false) => {
    const next = Math.round(Math.min(RAIL_WIDTH_MAX, Math.max(RAIL_WIDTH_MIN, width)));
    state.settings.railWidth = next;
    workspace.style.setProperty("--rail-width", `${next}px`);
    handle.setAttribute("aria-valuenow", String(next));
    if (persist) saveUserSettings();
  };

  handle.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    dragStart = { x: event.clientX, width: state.settings.railWidth };
    handle.setPointerCapture(event.pointerId);
    handle.classList.add("active");
    event.preventDefault();
  });
  handle.addEventListener("pointermove", (event) => {
    if (!dragStart || !handle.hasPointerCapture(event.pointerId)) return;
    applyWidth(dragStart.width + event.clientX - dragStart.x);
  });
  const finish = (event) => {
    if (!dragStart) return;
    if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
    dragStart = null;
    handle.classList.remove("active");
    saveUserSettings();
    drawCanvas();
  };
  handle.addEventListener("pointerup", finish);
  handle.addEventListener("pointercancel", finish);
  handle.addEventListener("keydown", (event) => {
    const delta = event.key === "ArrowLeft" ? -8 : event.key === "ArrowRight" ? 8 : 0;
    if (!delta && event.key !== "Home") return;
    event.preventDefault();
    applyWidth(event.key === "Home" ? DEFAULT_USER_SETTINGS.railWidth : state.settings.railWidth + delta, true);
    drawCanvas();
  });
  handle.addEventListener("dblclick", () => {
    applyWidth(DEFAULT_USER_SETTINGS.railWidth, true);
    drawCanvas();
  });
}

async function createNewDrawingFromForm(event) {
  event.preventDefault();
  const policy = ROLE_POLICIES[state.drawing.currentRole] ?? ROLE_POLICIES.viewer;
  if (!policy.canEdit) {
    log(`${policy.label}は図面を新規作成できません。`);
    /** @type {HTMLDialogElement} */ (document.querySelector("#newDrawingDialog")).close();
    render();
    return;
  }
  const form = /** @type {HTMLFormElement} */ (event.currentTarget);
  const data = new FormData(form);
  const name = String(data.get("name") ?? "新規図面").trim() || "新規図面";
  const unit = String(data.get("unit") ?? "mm");
  const template = String(data.get("template") ?? "blank");
  const role = state.drawing.currentRole;
  try {
    if (state.apiStatus.connected) {
      const body = await apiRequest("/api/drawings", {
        method: "POST",
        headers: idempotencyHeaders(),
        body: JSON.stringify({ name, unit, template })
      });
      state.drawing = { ...body.drawing, currentRole: role };
    } else {
      state.drawing = template === "demo" ? seedDrawing() : createDrawing();
      state.drawing.id = `dwg_${globalThis.crypto?.randomUUID?.().slice(0, 8) ?? Date.now()}`;
      state.drawing.name = name;
      state.drawing.unit = unit;
      state.drawing.currentRole = role;
    }
    resetAuthoringState();
    fitCameraToDrawing();
    /** @type {HTMLDialogElement} */ (document.querySelector("#newDrawingDialog")).close();
    persist(`新規図面作成: ${name}`);
  } catch (error) {
    log(`新規図面作成失敗: ${errorMessage(error)}`);
    render();
  }
}

async function handleImportFile(event) {
  const input = /** @type {HTMLInputElement} */ (event.currentTarget);
  const file = input.files?.[0];
  if (!file) return;
  try {
    const imported = parseCadImport({
      filename: file.name,
      content: await file.text(),
      drawing: state.drawing,
      currentLayerId: state.currentLayerId
    });
    const committed = await commitCommands(`Import: ${file.name}`, imported.commands);
    if (committed) {
      for (const warning of imported.warnings) log(`Import警告: ${warning}`);
      log(`Import完了: ${imported.entityCount}/${imported.sourceCount}図形`);
      fitCameraToDrawing();
      render();
    }
  } catch (error) {
    log(`Import失敗: ${errorMessage(error)}`);
    render();
  }
}

async function executeCommandLine(event) {
  event.preventDefault();
  const input = /** @type {HTMLInputElement} */ (document.querySelector("#commandInput"));
  const raw = input.value.trim();
  if (!raw) return;
  state.commandHistory.push(raw);
  state.commandHistory = state.commandHistory.slice(-50);
  state.commandHistoryIndex = state.commandHistory.length;
  state.focusTarget = "command";
  log(`> ${raw}`);
  try {
    const parsed = parseCadCommand(raw, {
      drawing: state.drawing,
      currentLayerId: state.currentLayerId,
      selectedId: state.selectedId
    });
    if (parsed.kind === "transaction") {
      await commitCommands(`CLI ${parsed.label}`, parsed.commands);
      return;
    }
    if (parsed.kind === "message") log(parsed.message);
    if (parsed.kind === "ui" && !(await executeUiCommand(parsed))) return;
  } catch (error) {
    log(`Command Error: ${errorMessage(error)}`);
  }
  render();
}

async function executeUiCommand(command) {
  if (command.action === "tool") {
    state.tool = command.tool;
    state.draftPoints = [];
    log(`ツール切替: ${command.tool}`);
  }
  if (command.action === "layer") {
    state.currentLayerId = command.layerId;
    log(`現在レイヤー: ${layerName(command.layerId)}`);
  }
  if (command.action === "fit") fitCameraToDrawing();
  if (command.action === "pan") {
    state.camera.x += command.offset.x * state.camera.scale;
    state.camera.y += command.offset.y * state.camera.scale;
    log(`パン: ${command.offset.x},${command.offset.y}`);
  }
  if (command.action === "plot") {
    printDrawing();
    return false;
  }
  if (command.action === "select") {
    state.selectedId = command.entityId;
    log(`選択: ${command.entityId}`);
  }
  if (command.action === "cancel") {
    state.draftPoints = [];
    state.selectedId = null;
    log("取消");
  }
  if (command.action === "undo") {
    await undoLastTransaction();
    return false;
  }
  if (command.action === "redo") {
    await redoLastTransaction();
    return false;
  }
  if (command.action === "new") {
    render();
    openNewDrawingDialog(command.name);
    return false;
  }
  if (command.action === "import") {
    /** @type {HTMLInputElement} */ (document.querySelector("#importFile")).click();
    return false;
  }
  return true;
}

function navigateCommandHistory(event) {
  if (!["ArrowUp", "ArrowDown"].includes(event.key)) return;
  event.preventDefault();
  if (event.key === "ArrowUp") state.commandHistoryIndex = Math.max(0, state.commandHistoryIndex - 1);
  if (event.key === "ArrowDown") state.commandHistoryIndex = Math.min(state.commandHistory.length, state.commandHistoryIndex + 1);
  event.currentTarget.value = state.commandHistory[state.commandHistoryIndex] ?? "";
}

function fitToDrawing() {
  fitCameraToDrawing();
  render();
}

function fitCameraToDrawing() {
  const bounds = state.drawing.entities.map(entityBounds).filter(Boolean);
  if (bounds.length === 0) {
    state.camera = { x: 45, y: 45, scale: 0.08 };
    return;
  }
  const minX = Math.min(...bounds.map((value) => value.minX));
  const minY = Math.min(...bounds.map((value) => value.minY));
  const maxX = Math.max(...bounds.map((value) => value.maxX));
  const maxY = Math.max(...bounds.map((value) => value.maxY));
  const width = Math.max(maxX - minX, 100);
  const height = Math.max(maxY - minY, 100);
  const scale = Math.min(0.5, Math.max(0.025, Math.min(1080 / width, 660 / height)));
  state.camera = { x: 50 - minX * scale, y: 50 - minY * scale, scale };
}

function resetAuthoringState() {
  state.currentLayerId = state.drawing.layers.some((layer) => layer.id === "layer-structure")
    ? "layer-structure"
    : state.drawing.layers[0]?.id;
  state.selectedId = null;
  state.draftPoints = [];
  state.previewProposal = null;
  state.previewRunId = null;
  state.viewMode = "normal";
  state.undoStack = [];
  state.redoStack = [];
  state.measurement = null;
}

async function applyOperationForm(event) {
  event.preventDefault();
  const selected = state.drawing.entities.find((entity) => entity.id === state.selectedId);
  if (!selected) return;
  const data = new FormData(event.currentTarget);
  const operation = String(data.get("operation"));
  const value = String(data.get("value") ?? "").trim();
  try {
    let next;
    if (["move", "copy"].includes(operation)) {
      const offset = parsePointValue(value, "dx,dy");
      next = transformEntity(selected, { dx: offset.x, dy: offset.y });
    }
    if (operation === "rotate") next = transformEntity(selected, { angle: parseNumberValue(value, "角度"), base: entityAnchor(selected) });
    if (operation === "scale") {
      const scale = parseNumberValue(value, "尺度");
      if (scale <= 0) throw new Error("尺度は0より大きい値を指定してください。");
      next = transformEntity(selected, { scale, base: entityAnchor(selected) });
    }
    if (operation === "offset") next = offsetEntity(selected, parseNumberValue(value, "距離"));
    if (["trim", "extend"].includes(operation)) next = editLineEndpoint(selected, parsePointValue(value, "x,y"), operation.toUpperCase());
    if (operation === "block") {
      const name = value || `BLOCK_${selected.id}`;
      const child = transformEntity(selected);
      child.id = `child_${Date.now().toString(36)}`;
      const block = blockEntity(selected.layerId, name, [0, 0], [child]);
      state.selectedId = block.id;
      await commitCommands("ブロック化", [{ op: "delete", id: selected.id }, { op: "add", entity: block }]);
      return;
    }
    if (!next) throw new Error("操作を選択してください。");
    if (["copy", "offset"].includes(operation)) {
      next.id = `e_${operation}_${Date.now().toString(36)}`;
      next.meta = { createdBy: "user", createdAt: new Date().toISOString() };
      state.selectedId = next.id;
      await commitCommands(operation === "copy" ? "図形複写" : "オフセット", [{ op: "add", entity: next }]);
    } else {
      await commitCommands(operation.toUpperCase(), [{ op: "update", id: selected.id, patch: withoutIdentity(next) }]);
    }
  } catch (error) {
    log(`操作失敗: ${errorMessage(error)}`);
    render();
  }
}

async function updateSelectedProperties(event) {
  event.preventDefault();
  const selected = state.drawing.entities.find((entity) => entity.id === state.selectedId);
  if (!selected) return;
  const data = new FormData(event.currentTarget);
  const strokeWidth = Number(data.get("strokeWidth"));
  await commitCommands("プロパティ更新", [{
    op: "update", id: selected.id,
    patch: {
      layerId: String(data.get("layerId")),
      style: { ...selected.style, strokeWidth },
      ...(selected.type === "block" ? { attributes: parseAttributes(String(data.get("blockAttributes") ?? "")) } : {})
    }
  }]);
}

async function createLayerFromForm(event) {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  const name = String(data.get("name") ?? "").trim();
  const id = `layer_${globalThis.crypto?.randomUUID?.().slice(0, 8) ?? Date.now().toString(36)}`;
  const succeeded = await commitCommands(`レイヤー追加: ${name}`, [{ op: "add_layer", layer: { id, name, color: String(data.get("color")) } }]);
  if (succeeded) state.currentLayerId = id;
}

async function updateLayoutFromForm(event) {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  await commitCommands("レイアウト設定", [{ op: "update_layout", patch: Object.fromEntries(data) }]);
}

function printDrawing() {
  document.body.dataset.printPaper = state.drawing.layout?.paper ?? "A3";
  log("印刷プレビューを開きます。送信先でPDF保存を選択できます。");
  render();
  setTimeout(() => window.print(), 0);
}

function zoomAtCenter(factor) {
  const canvas = /** @type {HTMLCanvasElement} */ (document.querySelector("#cadCanvas"));
  const before = screenToWorld(canvas.width / 2, canvas.height / 2);
  state.camera.scale = Math.min(2, Math.max(0.005, state.camera.scale * factor));
  const after = screenToWorld(canvas.width / 2, canvas.height / 2);
  state.camera.x += (after.x - before.x) * state.camera.scale;
  state.camera.y += (after.y - before.y) * state.camera.scale;
  log(`ズーム: ${Math.round(state.camera.scale * 1000)}%`);
  render();
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
  const rawWorld = screenToWorld(event.offsetX, event.offsetY);
  const world = state.tool === "select" ? rawWorld : snapPoint(rawWorld);
  const policy = ROLE_POLICIES[state.drawing.currentRole] ?? ROLE_POLICIES.viewer;

  if (state.tool === "pan" || event.button === 1) {
    state.panStart = { x: event.clientX, y: event.clientY, camera: { ...state.camera } };
    event.currentTarget.setPointerCapture(event.pointerId);
    return;
  }

  if (state.tool === "measure") {
    state.draftPoints.push(world);
    if (state.draftPoints.length === 2) {
      state.measurement = measurePoints(state.draftPoints[0], state.draftPoints[1]);
      log(`計測: 距離=${formatNumber(state.measurement.distance)} ${state.drawing.unit} / 角度=${formatNumber(state.measurement.angle)}°`);
      state.draftPoints = [];
      render();
    } else drawCanvas(world);
    return;
  }

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

  if (state.tool === "line" || state.tool === "rect" || state.tool === "circle" || state.tool === "dimension") {
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

  if (state.tool === "hatch") {
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
  if (state.panStart) {
    state.camera.x = state.panStart.camera.x + event.clientX - state.panStart.x;
    state.camera.y = state.panStart.camera.y + event.clientY - state.panStart.y;
    drawCanvas();
    return;
  }
  const rawWorld = screenToWorld(event.offsetX, event.offsetY);
  const world = state.drag ? rawWorld : snapPoint(rawWorld);
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
  if (state.panStart) {
    state.panStart = null;
    log("パン表示を更新");
    render();
    return;
  }
  if (!state.drag) return;
  const entity = state.drawing.entities.find((item) => item.id === state.drag.id);
  state.drawing.entities = state.drawing.entities.map((item) => (item.id === state.drag.id ? state.drag.original : item));
  const command = { op: "update", id: state.drag.id, patch: withoutIdentity(entity) };
  state.drag = null;
  commitCommands("図形移動", [command]);
}

function cancelDrag() {
  if (state.panStart) {
    state.camera = state.panStart.camera;
    state.panStart = null;
    render();
    return;
  }
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
  state.camera.scale = Math.min(2, Math.max(0.005, state.camera.scale * factor));
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
  if (event.key === "Enter" && state.tool === "hatch" && state.draftPoints.length >= 3) {
    commitCommands("ハッチング作成", [{ op: "add", entity: hatchEntity(state.currentLayerId, state.draftPoints) }]);
    state.draftPoints = [];
  }
  if (event.key === "0") fitToDrawing();
  if (event.key === "+" || event.key === "=") zoomAtCenter(1.25);
  if (event.key === "-") zoomAtCenter(0.8);
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
  if (state.tool === "dimension") {
    commands.push({ op: "add", entity: dimensionEntity(state.currentLayerId, a, b, {
      offset: state.settings.dimensionOffset, precision: state.settings.dimensionPrecision, suffix: state.settings.dimensionSuffix
    }) });
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

async function undoLastTransaction() {
  const target = state.undoStack.pop();
  if (!target) {
    log("元に戻せる操作がありません。");
    render();
    return;
  }
  const current = structuredClone(state.drawing);
  state.redoStack.push(current);
  const succeeded = await commitCommands("UNDO", snapshotCommands(state.drawing, target), { recordHistory: false });
  if (!succeeded) {
    state.redoStack.pop();
    state.undoStack.push(target);
  }
}

async function redoLastTransaction() {
  const target = state.redoStack.pop();
  if (!target) {
    log("やり直せる操作がありません。");
    render();
    return;
  }
  const current = structuredClone(state.drawing);
  state.undoStack.push(current);
  const succeeded = await commitCommands("REDO", snapshotCommands(state.drawing, target), { recordHistory: false });
  if (!succeeded) {
    state.undoStack.pop();
    state.redoStack.push(target);
  }
}

function snapshotCommands(current, target) {
  const commands = [];
  const currentById = new Map(current.entities.map((entity) => [entity.id, entity]));
  const targetById = new Map(target.entities.map((entity) => [entity.id, entity]));
  for (const entity of current.entities) {
    if (!targetById.has(entity.id)) commands.push({ op: "delete", id: entity.id });
  }
  for (const entity of target.entities) {
    const existing = currentById.get(entity.id);
    if (!existing) commands.push({ op: "add", entity: structuredClone(entity) });
    else if (JSON.stringify(existing) !== JSON.stringify(entity)) {
      commands.push({ op: "update", id: entity.id, patch: withoutIdentity(entity) });
    }
  }
  for (const layer of current.layers) {
    if (!target.layers.some((item) => item.id === layer.id)) {
      commands.push({ op: "delete_layer", id: layer.id });
    }
  }
  for (const layer of target.layers) {
    const existing = current.layers.find((item) => item.id === layer.id);
    if (!existing) commands.unshift({ op: "add_layer", layer: structuredClone(layer) });
    else if (JSON.stringify(existing) !== JSON.stringify(layer)) {
      commands.push({
        op: "update_layer",
        id: layer.id,
        patch: { visible: layer.visible, locked: layer.locked, printable: layer.printable, name: layer.name, color: layer.color }
      });
    }
  }
  if (JSON.stringify(current.layout) !== JSON.stringify(target.layout)) commands.push({ op: "update_layout", patch: target.layout });
  return commands;
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

async function commitCommands(label, commands, options = {}) {
  const before = structuredClone(state.drawing);
  if (state.apiStatus.connected) {
    try {
      const body = await apiRequest(`/api/drawings/${state.drawing.id}/transactions`, {
        method: "POST",
        headers: transactionHeaders(),
        body: JSON.stringify({ label, commands })
      });
      state.drawing = body.drawing;
      recordDrawingHistory(before, options);
      persist(`${label} / Neon同期`);
      return true;
    } catch (error) {
      log(`${label}失敗: ${errorMessage(error)}`);
      render();
      return false;
    }
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
    return false;
  }
  state.drawing = result.drawing;
  recordDrawingHistory(before, options);
  persist(label);
  return true;
}

function recordDrawingHistory(before, options) {
  if (options.recordHistory === false) return;
  state.undoStack.push(before);
  state.undoStack = state.undoStack.slice(-20);
  state.redoStack = [];
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
  if (!state.settings.showGrid) {
    ctx.restore();
    return;
  }
  ctx.strokeStyle = "#e4edf3";
  ctx.lineWidth = 1;
  const step = state.settings.gridInterval * state.camera.scale;
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
  if (entity.type === "dimension") {
    const [start, end] = entity.points;
    const length = Math.hypot(end.x - start.x, end.y - start.y);
    const normal = length ? { x: (-(end.y - start.y) / length) * entity.offset, y: ((end.x - start.x) / length) * entity.offset } : { x: 0, y: 0 };
    const a = worldToScreen(start);
    const b = worldToScreen(end);
    const da = worldToScreen({ x: start.x + normal.x, y: start.y + normal.y });
    const db = worldToScreen({ x: end.x + normal.x, y: end.y + normal.y });
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(da.x, da.y); ctx.moveTo(b.x, b.y); ctx.lineTo(db.x, db.y); ctx.moveTo(da.x, da.y); ctx.lineTo(db.x, db.y); ctx.stroke();
    const arrow = 7;
    ctx.fillStyle = overrideColor ?? layer.color;
    for (const arrowhead of [{ tip: da, direction: 1 }, { tip: db, direction: -1 }]) {
      const { tip, direction } = arrowhead;
      const angle = Math.atan2(db.y - da.y, db.x - da.x);
      ctx.beginPath(); ctx.moveTo(tip.x, tip.y); ctx.lineTo(tip.x + Math.cos(angle + 0.45) * arrow * direction, tip.y + Math.sin(angle + 0.45) * arrow * direction); ctx.lineTo(tip.x + Math.cos(angle - 0.45) * arrow * direction, tip.y + Math.sin(angle - 0.45) * arrow * direction); ctx.closePath(); ctx.fill();
    }
    const label = `${length.toFixed(entity.precision ?? 0)}${entity.suffix ?? ""}`;
    ctx.font = `${Math.max(11, 180 * state.camera.scale)}px sans-serif`;
    ctx.textAlign = "center";
    ctx.fillText(label, (da.x + db.x) / 2, (da.y + db.y) / 2 - 5);
  }
  if (entity.type === "hatch") {
    const points = entity.points.map(worldToScreen);
    ctx.beginPath(); ctx.moveTo(points[0].x, points[0].y);
    for (const pointValue of points.slice(1)) ctx.lineTo(pointValue.x, pointValue.y);
    ctx.closePath(); ctx.stroke(); ctx.clip();
    const bounds = entityBounds(entity);
    const a = worldToScreen({ x: bounds.minX, y: bounds.minY });
    const b = worldToScreen({ x: bounds.maxX, y: bounds.maxY });
    const spacing = Math.max(5, entity.spacing * state.camera.scale);
    for (let x = a.x - Math.abs(b.y - a.y); x < b.x + Math.abs(b.y - a.y); x += spacing) {
      ctx.beginPath(); ctx.moveTo(x, b.y); ctx.lineTo(x + (b.y - a.y), a.y); ctx.stroke();
    }
  }
  if (entity.type === "block") {
    for (const child of entity.children ?? []) {
      const transformed = transformEntity(child, { dx: entity.insertion?.x ?? 0, dy: entity.insertion?.y ?? 0, angle: entity.rotation ?? 0, scale: entity.scale ?? 1 });
      drawEntity(ctx, { ...transformed, layerId: entity.layerId }, overrideColor, preview);
    }
    const at = worldToScreen(entity.insertion ?? { x: 0, y: 0 });
    ctx.fillStyle = overrideColor ?? layer.color;
    ctx.font = "11px sans-serif";
    ctx.fillText(`${entity.name}${Object.keys(entity.attributes ?? {}).length ? ` [${Object.values(entity.attributes).join(" / ")}]` : ""}`, at.x + 5, at.y - 5);
  }
  ctx.restore();
}

function moveEntity(entity, dx, dy) {
  return transformEntity(entity, { dx, dy });
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

function snapPoint(point) {
  if (!state.settings.snapEnabled) return point;
  const interval = state.settings.gridInterval;
  return {
    x: Math.round(point.x / interval) * interval,
    y: Math.round(point.y / interval) * interval
  };
}

function persist(message) {
  saveDrawing(state.drawing);
  log(message);
  render();
}

async function checkApiHealth() {
  state.apiStatus = { state: "loading", message: "確認中", connected: false, roleLocked: false };
  render();
  try {
    const body = await apiRequest("/api/health");
    const drawingBody = await apiRequest("/api/drawings/demo");
    const roleLocked = body.auth.mode !== "demo";
    const selectedRole = roleLocked ? body.auth.role : state.drawing.currentRole;
    state.drawing = { ...drawingBody.drawing, currentRole: selectedRole };
    saveDrawing(state.drawing);
    state.apiStatus = {
      state: "ok",
      message: `${body.service} / ${body.auth.anonymous ? "公開閲覧" : `auth=${body.auth.mode}`} / db=${body.db.mode} / 同期済み`,
      connected: true,
      roleLocked
    };
  } catch (error) {
    state.apiStatus = { state: "error", message: `API未接続: ${errorMessage(error)}`, connected: false, roleLocked: false };
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
    ...idempotencyHeaders(),
    "expected-version": String(state.drawing.revision ?? 1)
  };
}

function idempotencyHeaders() {
  return { "idempotency-key": globalThis.crypto?.randomUUID?.() ?? `web-${Date.now()}` };
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

function parsePointValue(value, label) {
  const parts = String(value).split(",").map(Number);
  if (parts.length !== 2 || !parts.every(Number.isFinite)) throw new Error(`${label}形式で入力してください。`);
  return { x: parts[0], y: parts[1] };
}

function parseNumberValue(value, label) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`${label}を数値で入力してください。`);
  return parsed;
}

function entityAnchor(entity) {
  return entity.center ?? entity.origin ?? entity.at ?? entity.insertion ?? entity.points?.[0] ?? { x: 0, y: 0 };
}

function formatNumber(value) {
  return Math.round(Number(value) * 1000) / 1000;
}

function parseAttributes(value) {
  return Object.fromEntries(String(value).split(";").map((pair) => pair.split("=")).filter(([key, item]) => key?.trim() && item !== undefined).map(([key, item]) => [key.trim().slice(0, 40), item.trim().slice(0, 200)]));
}

function loadUserSettings() {
  try {
    const stored = JSON.parse(localStorage.getItem(USER_SETTINGS_KEY) ?? "null");
    const gridInterval = Number(stored?.gridInterval);
    const commandLogLines = Number(stored?.commandLogLines);
    const dimensionOffset = Number(stored?.dimensionOffset);
    const dimensionPrecision = Number(stored?.dimensionPrecision);
    const railWidth = Number(stored?.railWidth);
    return {
      showGrid: typeof stored?.showGrid === "boolean" ? stored.showGrid : DEFAULT_USER_SETTINGS.showGrid,
      snapEnabled: typeof stored?.snapEnabled === "boolean" ? stored.snapEnabled : DEFAULT_USER_SETTINGS.snapEnabled,
      gridInterval: GRID_INTERVALS.has(gridInterval) ? gridInterval : DEFAULT_USER_SETTINGS.gridInterval,
      commandLogLines: [1, 2, 3].includes(commandLogLines) ? commandLogLines : DEFAULT_USER_SETTINGS.commandLogLines,
      dimensionOffset: Number.isFinite(dimensionOffset) && dimensionOffset >= 0 ? dimensionOffset : DEFAULT_USER_SETTINGS.dimensionOffset,
      dimensionPrecision: [0, 1, 2, 3].includes(dimensionPrecision) ? dimensionPrecision : DEFAULT_USER_SETTINGS.dimensionPrecision,
      dimensionSuffix: typeof stored?.dimensionSuffix === "string" ? stored.dimensionSuffix.slice(0, 12) : DEFAULT_USER_SETTINGS.dimensionSuffix,
      railWidth: Number.isFinite(railWidth) ? Math.min(RAIL_WIDTH_MAX, Math.max(RAIL_WIDTH_MIN, railWidth)) : DEFAULT_USER_SETTINGS.railWidth
    };
  } catch {
    return { ...DEFAULT_USER_SETTINGS };
  }
}

function saveUserSettings() {
  localStorage.setItem(USER_SETTINGS_KEY, JSON.stringify(state.settings));
}

render();
