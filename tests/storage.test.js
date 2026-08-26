import test from "node:test";
import assert from "node:assert/strict";
import { seedDrawing } from "../src/cad-core.js";
import { isStoredDrawing } from "../src/storage.js";

test("stored drawing validation accepts the current schema", () => {
  assert.equal(isStoredDrawing(seedDrawing()), true);
});

test("stored drawing validation rejects malformed and old schemas", () => {
  assert.equal(isStoredDrawing({}), false);
  assert.equal(isStoredDrawing({ ...seedDrawing(), schemaVersion: 0 }), false);
  assert.equal(isStoredDrawing({ ...seedDrawing(), layers: [{ id: "unsafe" }] }), false);
});
