import test from "node:test";
import assert from "node:assert/strict";
import { seedDrawing } from "../src/cad-core.js";
import { drawingFilename, isStoredDrawing } from "../src/storage.js";

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
