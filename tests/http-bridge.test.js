import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { applyEdgeHeaders, loadHeaderRules, makeHeadersResolver, STRICT_TRANSPORT_SECURITY } from "../scripts/lib/http-bridge.mjs";

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

test("_headersはHSTSを全パスへ付与する(API応答の抜けを塞ぐ)", async () => {
  const rules = await loadHeaderRules(headersFile);
  const headersForPath = makeHeadersResolver(rules);
  assert.equal(headersForPath("/api/health")["Strict-Transport-Security"], STRICT_TRANSPORT_SECURITY);
  assert.equal(headersForPath("/index.html")["Strict-Transport-Security"], STRICT_TRANSPORT_SECURITY);
});

test("API応答にもCSP/HSTSを補う(アプリ設定ヘッダは上書きしない)", async () => {
  const rules = await loadHeaderRules(headersFile);
  const headersForPath = makeHeadersResolver(rules);
  const headers = new Headers({
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-frame-options": "SAMEORIGIN"
  });
  applyEdgeHeaders(headers, headersForPath("/api/health"));
  // _headersに無い=アプリ設定が残る
  assert.equal(headers.get("cache-control"), "no-store");
  // アプリが明示している値は_headersより優先される
  assert.equal(headers.get("x-frame-options"), "SAMEORIGIN");
  // 不足分は補われる
  assert.equal(headers.get("strict-transport-security"), STRICT_TRANSPORT_SECURITY);
  assert.match(headers.get("content-security-policy"), /frame-ancestors 'none'/);
});

test("applyEdgeHeadersはHSTSを無効化できる(ローカル開発でHTTPSを強制しない)", () => {
  const headers = new Headers();
  applyEdgeHeaders(headers, { "x-test": "1" }, "");
  assert.equal(headers.get("strict-transport-security"), null);
  assert.equal(headers.get("x-test"), "1");
});
