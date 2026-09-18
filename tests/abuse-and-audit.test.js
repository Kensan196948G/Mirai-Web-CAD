import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { handleApiRequest, resetMemoryStore } from "../src/api-handler.js";
import { createDataStore } from "../src/data-store.js";
import { findMalformedHeaderLines } from "../scripts/lib/http-bridge.mjs";

// 2026-09-18の追加精査で残っていた「濫用対策」と「監査完全性」の弱点に対する回帰テスト。
//  - 更新系APIにレート制限が無く、AI提案だけが制限されていた
//  - 監査行の挿入が `on conflict do nothing` のため、衝突時に黙って記録が落ちていた
//  - `_headers`の書式違反行が黙って捨てられ、CSPが無言で欠落し得た

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const env = { AUTH_MODE: "demo", APP_ENV: "preview" };

function createDrawingRequest(key) {
  return new Request("https://example.test/api/drawings", {
    method: "POST",
    headers: { "content-type": "application/json", "x-demo-role": "drafter", "idempotency-key": key },
    body: JSON.stringify({ name: "レート制限検証", unit: "mm" })
  });
}

test("更新系APIは利用者ごとの上限を超えると429を返す", async () => {
  resetMemoryStore();
  const limited = { ...env, WRITE_RATE_LIMIT_PER_MINUTE: "2" };
  assert.equal((await handleApiRequest(createDrawingRequest("rl-1"), limited)).status, 201);
  assert.equal((await handleApiRequest(createDrawingRequest("rl-2"), limited)).status, 201);
  const third = await handleApiRequest(createDrawingRequest("rl-3"), limited);
  assert.equal(third.status, 429);
  const body = await third.json();
  assert.match(body.error, /上限/);
});

test("読み取り(GET /api/health)は更新系の上限に数えられない", async () => {
  resetMemoryStore();
  const limited = { ...env, WRITE_RATE_LIMIT_PER_MINUTE: "1" };
  assert.equal((await handleApiRequest(createDrawingRequest("rl-4"), limited)).status, 201);
  for (let i = 0; i < 5; i += 1) {
    const health = await handleApiRequest(new Request("https://example.test/api/health"), limited);
    assert.equal(health.status, 200);
  }
});

test("AI提案経路も更新系の上限に含まれる(別バケットでも素通りしない)", async () => {
  resetMemoryStore();
  const limited = { ...env, WRITE_RATE_LIMIT_PER_MINUTE: "1" };
  assert.equal((await handleApiRequest(createDrawingRequest("rl-5"), limited)).status, 201);
  const ai = await handleApiRequest(
    new Request("https://example.test/api/drawings/dwg_demo_001/agent-runs", {
      method: "POST",
      headers: { "content-type": "application/json", "x-demo-role": "drafter", "idempotency-key": "ai-1" },
      body: JSON.stringify({ prompt: "線を追加" })
    }),
    limited
  );
  assert.equal(ai.status, 429);
  const body = await ai.json();
  // AI固有の上限(「AI提案のリクエスト回数」)ではなく、更新系バケットの上限であること
  // = 2つの上限が別々のキーで数えられていることの確認。
  assert.match(body.error, /更新リクエストの回数/);
});

test("resetMemoryStoreはレート制限の状態も消す(テスト間の持ち越しを防ぐ)", async () => {
  const limited = { ...env, WRITE_RATE_LIMIT_PER_MINUTE: "1" };
  resetMemoryStore();
  assert.equal((await handleApiRequest(createDrawingRequest("rl-6"), limited)).status, 201);
  assert.equal((await handleApiRequest(createDrawingRequest("rl-7"), limited)).status, 429);
  resetMemoryStore();
  assert.equal((await handleApiRequest(createDrawingRequest("rl-8"), limited)).status, 201);
});

test("監査行の重複IDは黙って落とさず例外にする", async () => {
  resetMemoryStore();
  const store = createDataStore({});
  const entry = {
    id: "audit_duplicate_probe",
    actorId: "tester@example.com",
    role: "drafter",
    action: "test.action",
    targetType: "test",
    targetId: "x",
    detail: {},
    createdAt: new Date().toISOString()
  };
  await store.appendAudit(entry);
  await assert.rejects(() => store.appendAudit(entry), /監査ログを記録できませんでした/);
  const logs = await store.listAuditLogs(100, 0);
  assert.equal(logs.filter((item) => item.id === "audit_duplicate_probe").length, 1);
});

test("実際の_headersに書式違反はない", async () => {
  const { readFile } = await import("node:fs/promises");
  const text = await readFile(path.join(__dirname, "..", "_headers"), "utf8");
  assert.deepEqual(findMalformedHeaderLines(text), []);
});

test("_headersの書式違反を検出する", () => {
  const problems = findMalformedHeaderLines(
    [
      "Content-Security-Policy: default-src 'self'", // パス行の欠落
      "/api/*",
      "  X-Content-Type-Options nosniff", // コロン欠落
      "  X-Frame-Options:", // 値が空
      "  : DENY", // 名前が空
      "badpattern",
      "  Referrer-Policy: no-referrer"
    ].join("\n")
  );
  assert.equal(problems.length, 5);
  assert.deepEqual(problems.map((problem) => problem.line), [1, 3, 4, 5, 6]);
});

test("コメントや空行は書式違反として扱わない", () => {
  assert.deepEqual(findMalformedHeaderLines("\n/*\n  X-Test: 1\n\n/assets/*\n  Cache-Control: no-store\n"), []);
});
