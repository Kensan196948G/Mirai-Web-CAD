import test from "node:test";
import assert from "node:assert/strict";
import { createDataStore, closeDataStorePool } from "../src/data-store.js";
import { createDrawing } from "../src/cad-core.js";

// 本番用DATABASE_URLを設定したシェルでうっかりnpm testを実行しても本番DBへ
// 書き込まないよう、専用の環境変数TEST_DATABASE_URLのみを見る(DATABASE_URLは
// 意図的に無視する)。加えて、接続先のDB名が"test"を含むことを要求し、命名を
// 誤った検証用DBへの書き込みも防ぐ。いずれかを満たさない場合はこのファイル
// 全体をskipする(通常のnpm test実行では未設定なので常にskipされる)。
const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const databaseNameLooksLikeTest = isTestDatabaseUrl(testDatabaseUrl);
const skipReason = !testDatabaseUrl
  ? "TEST_DATABASE_URLが未設定のためskip"
  : !databaseNameLooksLikeTest
    ? 'TEST_DATABASE_URLのDB名に"test"が含まれないためskip(本番DBへの誤書き込み防止)'
    : false;

test("PostgreSQL統合テスト", { skip: skipReason }, async (t) => {
  const store = createDataStore({ DATABASE_URL: testDatabaseUrl });

  await t.test("probeが接続済み・migration適用済みを返す", async () => {
    const probe = await store.probe();
    assert.equal(probe.provider, "postgres");
    assert.equal(probe.mode, "connected");
    assert.equal(probe.migrated, true);
  });

  await t.test("createDrawingAtomicallyが成功し、同一Idempotency-Keyの再送は23505経由でfalseになる", async () => {
    const drawing = createDrawing();
    drawing.id = `dwg_it_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    drawing.currentRole = "drafter";
    const auditEntry = {
      id: `audit_it_${Date.now()}`,
      actorId: "it@test",
      role: "drafter",
      action: "drawing.created",
      targetType: "drawing",
      targetId: drawing.id,
      detail: { name: drawing.name },
      createdAt: new Date().toISOString()
    };
    const idempotencyKey = `idem_it_create_${Date.now()}`;

    const created = await store.createDrawingAtomically(drawing, auditEntry, idempotencyKey, "it@test", "/api/drawings");
    assert.equal(created, true);

    const duplicate = await store.createDrawingAtomically(drawing, auditEntry, idempotencyKey, "it@test", "/api/drawings");
    assert.equal(duplicate, false, "同一Idempotency-Keyの再送はfalseを返す(トランザクション書き換え後も冪等性を維持)");
  });

  await t.test("getDrawingのpublicOnly boolean引数が正しく型付けされる", async () => {
    const drawing = createDrawing();
    drawing.id = `dwg_it_pub_${Date.now()}`;
    drawing.currentRole = "drafter";
    const auditEntry = {
      id: `audit_it_pub_${Date.now()}`,
      actorId: "it@test",
      role: "drafter",
      action: "drawing.created",
      targetType: "drawing",
      targetId: drawing.id,
      detail: {},
      createdAt: new Date().toISOString()
    };
    await store.createDrawingAtomically(drawing, auditEntry, `idem_it_pub_${Date.now()}`, "it@test", "/api/drawings");

    const privateVisible = await store.getDrawing(drawing.id, false);
    assert.ok(privateVisible, "publicOnly=falseでは非公開図面も取得できる");

    const publicOnlyHidden = await store.getDrawing(drawing.id, true);
    assert.equal(publicOnlyHidden, null, "publicOnly=trueでは非公開図面(visibility=private既定)は取得できない");
  });

  await t.test("saveDrawingAtomicallyがcommandEvent=nullのケース(裸booleanのWHERE句)を処理できる", async () => {
    const drawing = createDrawing();
    drawing.id = `dwg_it_save_${Date.now()}`;
    drawing.currentRole = "drafter";
    const createAudit = {
      id: `audit_it_save_c_${Date.now()}`,
      actorId: "it@test",
      role: "drafter",
      action: "drawing.created",
      targetType: "drawing",
      targetId: drawing.id,
      detail: {},
      createdAt: new Date().toISOString()
    };
    await store.createDrawingAtomically(drawing, createAudit, `idem_it_save_c_${Date.now()}`, "it@test", "/api/drawings");
    const current = await store.getDrawing(drawing.id, false);

    const next = { ...current, revision: (current.revision ?? 1) + 1, name: "統合テスト更新" };
    const updateAudit = {
      id: `audit_it_save_u_${Date.now()}`,
      actorId: "it@test",
      role: "approver",
      action: "review.submitted",
      targetType: "drawing",
      targetId: drawing.id,
      detail: {},
      createdAt: new Date().toISOString()
    };
    const saved = await store.saveDrawingAtomically(next, updateAudit, `idem_it_save_u_${Date.now()}`, "it@test", "/api/drawings/x/review");
    assert.equal(saved, true);

    const reloaded = await store.getDrawing(drawing.id, false);
    assert.equal(reloaded.name, "統合テスト更新");
    assert.equal(reloaded.revision, next.revision);
  });

  await t.test("saveDrawingAtomicallyがrevision競合を409相当で検出する", async () => {
    const drawing = createDrawing();
    drawing.id = `dwg_it_conflict_${Date.now()}`;
    drawing.currentRole = "drafter";
    const createAudit = {
      id: `audit_it_conflict_c_${Date.now()}`,
      actorId: "it@test",
      role: "drafter",
      action: "drawing.created",
      targetType: "drawing",
      targetId: drawing.id,
      detail: {},
      createdAt: new Date().toISOString()
    };
    await store.createDrawingAtomically(drawing, createAudit, `idem_it_conflict_c_${Date.now()}`, "it@test", "/api/drawings");

    const staleNext = { ...drawing, revision: 999, name: "古いrevisionからの更新" };
    const updateAudit = {
      id: `audit_it_conflict_u_${Date.now()}`,
      actorId: "it@test",
      role: "drafter",
      action: "drawing.transaction",
      targetType: "drawing",
      targetId: drawing.id,
      detail: {},
      createdAt: new Date().toISOString()
    };
    await assert.rejects(
      () => store.saveDrawingAtomically(staleNext, updateAudit, `idem_it_conflict_u_${Date.now()}`, "it@test", "/api/drawings/x/transactions"),
      (error) => {
        assert.equal(error.status, 409);
        return true;
      }
    );
  });

  await t.test("appendAudit・listAuditLogs・countAuditLogsが一貫して動作する", async () => {
    const before = await store.countAuditLogs();
    await store.appendAudit({
      id: `audit_it_append_${Date.now()}`,
      actorId: "it@test",
      role: "viewer",
      action: "audit.exported",
      targetType: "audit_logs",
      targetId: "bulk",
      detail: { count: 1 },
      createdAt: new Date().toISOString()
    });
    const after = await store.countAuditLogs();
    assert.equal(after, before + 1);

    const logs = await store.listAuditLogs(5, 0);
    assert.ok(Array.isArray(logs));
    assert.ok(logs.length > 0);
  });

  t.after(async () => {
    await closeDataStorePool();
  });
});

function isTestDatabaseUrl(connectionString) {
  if (!connectionString) return false;
  try {
    const url = new URL(connectionString);
    const databaseName = url.pathname.replace(/^\//, "");
    return databaseName.toLowerCase().includes("test");
  } catch {
    return false;
  }
}
