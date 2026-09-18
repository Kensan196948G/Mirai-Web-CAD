import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { handleApiRequest, resetMemoryStore } from "../src/api-handler.js";

// 2026-09-18 独立監査(3件)で確定した未解決項目のうち、コードのみで解消できるものの回帰テスト。
//  - P0-77: MAX_COMMAND_POINTSが実ペイロード形状(entity.points/patch.points)に効いていない
//  - P0-80: 404本文の差による案件・図面IDの存在オラクル / GETで監査行を追記するCSV出力
//  - P0-79: ACCESS_DEFAULT_ROLEの起動時未検証

const env = { AUTH_MODE: "demo", APP_ENV: "preview" };
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, "..");

function request(pathname, { method = "GET", role = "drafter", actorId = "demo@example.com", idempotencyKey, body, expectedVersion, contentType } = {}) {
  const headers = { "x-demo-role": role, "x-demo-actor": actorId };
  if (idempotencyKey) headers["idempotency-key"] = idempotencyKey;
  if (expectedVersion !== undefined) headers["expected-version"] = String(expectedVersion);
  if (body !== undefined) headers["content-type"] = contentType ?? "application/json";
  return handleApiRequest(
    new Request(`https://example.test/api${pathname}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined }),
    env
  );
}

async function createBlankDrawing(id) {
  const response = await request("/drawings", { method: "POST", role: "drafter", idempotencyKey: `create-${id}`, body: { id, name: "検証", unit: "mm" } });
  assert.equal(response.status, 201, await response.text());
}

test("点列長の上限は実ペイロード形状(entity.points/patch.points)にも適用される", async () => {
  resetMemoryStore();
  await createBlankDrawing("dwg_pts");
  const huge = Array.from({ length: 10_001 }, (_unused, index) => ({ x: index, y: 0 }));

  // 実クライアント(SPA / cad-command.js)が送る形状: op:"add" は entity に図形本体を持つ
  const add = await request("/drawings/dwg_pts/transactions", {
    method: "POST", idempotencyKey: "tx-p1", expectedVersion: 1,
    body: { label: "add", commands: [{ op: "add", entity: { id: "e_big", type: "polyline", layerId: "layer-frame", points: huge } }] }
  });
  assert.equal(add.status, 413, `entity.pointsの上限が効いていない: ${add.status}`);

  // op:"update" は patch に図形本体を持つ
  const update = await request("/drawings/dwg_pts/transactions", {
    method: "POST", idempotencyKey: "tx-p2", expectedVersion: 1,
    body: { label: "update", commands: [{ op: "update", id: "e_frame_1", patch: { points: huge } }] }
  });
  assert.equal(update.status, 413, `patch.pointsの上限が効いていない: ${update.status}`);
});

test("存在しない図面と権限のない案件の図面は本文まで同一の404を返す", async () => {
  resetMemoryStore();
  const created = await request("/projects", { method: "POST", role: "cad_admin", idempotencyKey: "proj-oracle", body: { name: "分離案件", accessScope: "restricted" } });
  assert.equal(created.status, 201);
  const projectId = (await created.json()).project.id;
  const drawing = await request("/drawings", { method: "POST", role: "cad_admin", idempotencyKey: "dwg-oracle", body: { id: "dwg_oracle", name: "分離図面", projectId } });
  assert.equal(drawing.status, 201, await drawing.text());

  // 非会員(drafter)からのアクセス。存在しないIDを引いた場合と本文が一致しなければ、
  // 「存在するが権限が無い」と「存在しない」を区別できてしまう。
  const denied = await request("/drawings/dwg_oracle", { role: "drafter" });
  const missing = await request("/drawings/dwg_does_not_exist", { role: "drafter" });
  assert.equal(denied.status, 404);
  assert.equal(missing.status, 404);
  const deniedBody = await denied.json();
  const missingBody = await missing.json();
  assert.equal(deniedBody.error, missingBody.error, "404本文が異なると存在オラクルになる");
});

test("監査CSVはPOSTでのみ出力し、GETは状態を変更しない", async () => {
  resetMemoryStore();
  await createBlankDrawing("dwg_csv");

  // GETは読み取りのみ。以前は?format=csvでCSVを返しつつaudit.exportedを追記していた。
  const get = await request("/audit-logs?format=csv", { role: "approver" });
  assert.equal(get.status, 200);
  assert.match(get.headers.get("content-type"), /application\/json/, "GETでCSV(状態変更を伴う出力)を返さない");
  const listed = await get.json();
  assert.equal(listed.auditLogs.some((entry) => entry.action === "audit.exported"), false, "GETでaudit.exportedを追記しない");

  // POST + application/json。preflightを要する形にしてクロスサイトのsimple requestを成立させない。
  const noContentType = await handleApiRequest(new Request("https://example.test/api/audit-logs/export", { method: "POST", headers: { "x-demo-role": "approver" } }), env);
  assert.equal(noContentType.status, 415);

  const exported = await handleApiRequest(new Request("https://example.test/api/audit-logs/export", { method: "POST", headers: { "content-type": "application/json", "x-demo-role": "approver" } }), env);
  assert.equal(exported.status, 200);
  assert.match(exported.headers.get("content-type"), /text\/csv/);
  const csvBody = await exported.text();
  assert.ok(csvBody.length > 0);

  const after = await request("/audit-logs", { role: "approver" });
  const entries = (await after.json()).auditLogs;
  assert.equal(entries.some((entry) => entry.action === "audit.exported"), true, "POST出力は監査に記録する");
});

test("ACCESS_DEFAULT_ROLEが未知のロールなら本番サーバーは起動を拒否する", () => {
  const baseEnv = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    DATABASE_URL: "postgresql://user:pass@127.0.0.1:5432/example",
    APP_ENV: "production",
    AUTH_MODE: "access",
    CF_ACCESS_TEAM_DOMAIN: "team.cloudflareaccess.com",
    CF_ACCESS_AUD: "aud",
    CORS_ORIGIN: "https://example.test",
    ACCESS_ROLE_MAP: JSON.stringify({ "user@example.test": "drafter" }),
    ACCESS_DEFAULT_ROLE: "superuser"
  };
  let failed = null;
  try {
    execFileSync(process.execPath, [path.join(repoRoot, "scripts", "serve-production.mjs")], { env: baseEnv, stdio: "pipe", timeout: 20_000 });
  } catch (error) {
    failed = error;
  }
  assert.ok(failed, "未知のACCESS_DEFAULT_ROLEで起動してはならない");
  assert.equal(failed.status, 78, "EX_CONFIG(78)で終了する");
  assert.match(String(failed.stdout), /ACCESS_DEFAULT_ROLE is not a known role/);
});
