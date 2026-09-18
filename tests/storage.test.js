import test from "node:test";
import assert from "node:assert/strict";
import { seedDrawing } from "../src/cad-core.js";
import { drawingFilename, isStoredDrawing, loadDrawing, saveDrawing } from "../src/storage.js";

// localStorageのスタブを差し替えて、容量超過等の失敗経路を検証できるようにする。
function withLocalStorage(stub, run) {
  const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", { value: stub, configurable: true, writable: true });
  try {
    return run();
  } finally {
    if (original) Object.defineProperty(globalThis, "localStorage", original);
    else delete globalThis.localStorage;
  }
}

test("stored drawing validation accepts the current schema", () => {
  assert.equal(isStoredDrawing(seedDrawing()), true);
});

test("stored drawing validation rejects malformed and old schemas", () => {
  assert.equal(isStoredDrawing({}), false);
  assert.equal(isStoredDrawing({ ...seedDrawing(), schemaVersion: 0 }), false);
  assert.equal(isStoredDrawing({ ...seedDrawing(), layers: [{ id: "unsafe" }] }), false);
});

test("drawingFilenameは日本語図面名を保持しバージョンと拡張子を付与する", () => {
  assert.equal(drawingFilename("道路拡幅 仮設施工図", 3, "dxf"), "道路拡幅 仮設施工図_v3.dxf");
  assert.equal(drawingFilename("新規図面", 1, "json"), "新規図面_v1.json");
  assert.equal(drawingFilename("a/b:c*d?", 2, "json"), "a_b_c_d__v2.json");
  assert.equal(drawingFilename("   ", 1, "dxf"), "drawing_v1.dxf");
  assert.equal(drawingFilename("", 1, "json"), "drawing_v1.json");
});

// 保存失敗が例外として伝播すると、呼び出し側の画面更新・ログに到達せず
// 「画面には反映されたが保存されていない」無言のデータ喪失になる(独立レビュー2026-09-18)。
test("saveDrawingは容量超過でも例外を投げず失敗を返す", () => {
  const result = withLocalStorage(
    {
      setItem() {
        throw new DOMException("quota exceeded", "QuotaExceededError");
      },
      getItem() {
        return null;
      },
      removeItem() {}
    },
    () => saveDrawing(seedDrawing())
  );
  assert.equal(result.ok, false);
  assert.match(result.reason, /保存領域が不足|保存できません/);
});

test("saveDrawingはプライベートモード等の失敗でも失敗を返す", () => {
  const result = withLocalStorage(
    {
      setItem() {
        throw new Error("storage disabled");
      },
      getItem() {
        return null;
      },
      removeItem() {}
    },
    () => saveDrawing(seedDrawing())
  );
  assert.equal(result.ok, false);
  assert.equal(typeof result.reason, "string");
});

test("saveDrawingは成功時にokを返し、loadDrawingで読み戻せる", () => {
  const store = new Map();
  const result = withLocalStorage(
    {
      setItem: (key, value) => store.set(key, String(value)),
      getItem: (key) => (store.has(key) ? store.get(key) : null),
      removeItem: (key) => store.delete(key)
    },
    () => {
      const saved = saveDrawing(seedDrawing());
      assert.deepEqual(saved, { ok: true });
      return loadDrawing();
    }
  );
  assert.equal(result?.id, seedDrawing().id);
});

test("loadDrawingは壊れたJSONでnullを返す(例外を投げない)", () => {
  const result = withLocalStorage(
    {
      setItem() {},
      getItem: () => "{壊れた",
      removeItem() {}
    },
    () => loadDrawing()
  );
  assert.equal(result, null);
});
