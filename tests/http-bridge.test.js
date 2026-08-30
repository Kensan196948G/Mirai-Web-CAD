import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadHeaderRules, makeHeadersResolver } from "../scripts/lib/http-bridge.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const headersFile = path.join(__dirname, "..", "_headers");

test("/src/* application code is not cached at the edge without revalidation", async () => {
  const rules = await loadHeaderRules(headersFile);
  const headersForPath = makeHeadersResolver(rules);
  assert.equal(headersForPath("/src/app.js")["Cache-Control"], "no-cache, must-revalidate");
  assert.equal(headersForPath("/src/styles.css")["Cache-Control"], "no-cache, must-revalidate");
});

test("/assets/* keeps long-lived immutable caching", async () => {
  const rules = await loadHeaderRules(headersFile);
  const headersForPath = makeHeadersResolver(rules);
  assert.equal(headersForPath("/assets/main.abc123.js")["Cache-Control"], "public, max-age=31536000, immutable");
});

test("root document is not covered by a long-lived Cache-Control rule", async () => {
  const rules = await loadHeaderRules(headersFile);
  const headersForPath = makeHeadersResolver(rules);
  assert.equal(headersForPath("/")["Cache-Control"], undefined);
  assert.equal(headersForPath("/index.html")["Cache-Control"], undefined);
});
