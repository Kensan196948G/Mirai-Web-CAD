import test from "node:test";
import assert from "node:assert/strict";
import { handleApiRequest, resetMemoryStore } from "../src/api-handler.js";

// 稼働中のPages環境で「AUTH_MODE未設定 → demo認証(ヘッダー自己申告)」へフォールバックし、
// 未認証の第三者が cad_admin 相当の権限を得られる経路が生じ得たため、その再発防止を固定する。
// 参照: src/api-handler.js authMode / resolveActor、functions/api/[[path]].js

const pagesFunction = await import("../functions/api/[[path]].js");

function failingStore(message) {
  return {
    probe: async () => {
      throw new Error(message);
    }
  };
}

test("AUTH_MODE未設定はdemoではなくaccessへfail-closedに倒す", async () => {
  resetMemoryStore();
  const response = await handleApiRequest(
    new Request("https://example.test/api/drawings/dwg_demo_001/transactions", {
      method: "POST",
      headers: { "content-type": "application/json", "x-demo-role": "cad_admin", "idempotency-key": "k", "expected-version": "1" },
      body: JSON.stringify({ commands: [] })
    }),
    { APP_ENV: "preview" }
  );
  const body = await response.json();
  assert.equal(response.status, 401);
  assert.match(body.error, /Cloudflare Access/);
});

test("AUTH_MODEに想定外の値を設定してもaccessとして扱う", async () => {
  resetMemoryStore();
  const response = await handleApiRequest(
    new Request("https://example.test/api/drawings/dwg_demo_001/transactions", {
      method: "POST",
      headers: { "x-demo-role": "cad_admin", "idempotency-key": "k", "expected-version": "1" }
    }),
    { APP_ENV: "preview", AUTH_MODE: "Demo" }
  );
  assert.equal(response.status, 401);
});

test("APP_ENV=production ではdemo認証を拒否する", async () => {
  resetMemoryStore();
  const response = await handleApiRequest(
    new Request("https://example.test/api/drawings/dwg_demo_001/transactions", {
      method: "POST",
      headers: { "x-demo-role": "cad_admin", "idempotency-key": "k", "expected-version": "1" }
    }),
    { APP_ENV: "production", AUTH_MODE: "demo" }
  );
  const body = await response.json();
  assert.equal(response.status, 401);
  assert.match(body.error, /デモ認証/);
});

test("health は access モードでも匿名で読める(公開読み取りは維持)", async () => {
  resetMemoryStore();
  const response = await handleApiRequest(
    new Request("https://example.test/api/health"),
    { APP_ENV: "preview", AUTH_MODE: "access" }
  );
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.auth.mode, "access");
  assert.equal(body.auth.anonymous, true);
});

test("5xxの内部詳細はaccess(browser公開環境)では伏せる", async () => {
  const response = await handleApiRequest(
    new Request("https://example.test/api/health"),
    {
      APP_ENV: "preview",
      AUTH_MODE: "access",
      DATA_STORE: failingStore("password authentication failed for user 'neondb_owner'")
    }
  );
  const body = await response.json();
  assert.equal(response.status, 500);
  assert.equal(body.error, "internal error");
  assert.equal(JSON.stringify(body).includes("neondb_owner"), false);
});

test("5xxの内部詳細はローカルdemoモードでのみ表示する", async () => {
  const response = await handleApiRequest(
    new Request("https://example.test/api/health"),
    {
      APP_ENV: "preview",
      AUTH_MODE: "demo",
      DATA_STORE: failingStore("connection refused")
    }
  );
  const body = await response.json();
  assert.equal(response.status, 500);
  assert.equal(body.error, "connection refused");
});

test("Pages Functions は AUTH_MODE が access 以外なら 503 でAPIを提供しない", async () => {
  const blocked = await pagesFunction.onRequest({
    request: new Request("https://mirai-web-cad.pages.dev/api/health"),
    env: { AUTH_MODE: "demo" }
  });
  assert.equal(blocked.status, 503);
  const blockedBody = await blocked.json();
  assert.equal(blockedBody.ok, false);
});

test("Pages Functions は AUTH_MODE 未設定でも 503 でAPIを提供しない", async () => {
  const blocked = await pagesFunction.onRequest({
    request: new Request("https://mirai-web-cad.pages.dev/api/health"),
    env: {}
  });
  assert.equal(blocked.status, 503);
});

test("Pages Functions は AUTH_MODE=access のときだけAPIへ委譲する", async () => {
  resetMemoryStore();
  const response = await pagesFunction.onRequest({
    request: new Request("https://mirai-web-cad.pages.dev/api/health"),
    env: { AUTH_MODE: "access", APP_ENV: "preview" }
  });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.auth.mode, "access");
});
