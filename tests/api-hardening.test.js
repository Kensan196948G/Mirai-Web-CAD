import test from "node:test";
import assert from "node:assert/strict";
import { csvEscape, handleApiRequest, resetMemoryStore } from "../src/api-handler.js";

// 2026-09-18の追加セキュリティ精査で検出した、API入力検証・冪等キー・CSV出力の
// 弱点に対する回帰テスト。いずれも「機能が動く」ことではなく「不正入力で
// 誤った成功や恒久的な操作不能に陥らない」ことを固定する。

const env = { AUTH_MODE: "demo", APP_ENV: "preview" };

async function createBlankDrawing(id) {
  const response = await handleApiRequest(
    new Request("https://example.test/api/drawings", {
      method: "POST",
      headers: { "content-type": "application/json", "x-demo-role": "drafter", "idempotency-key": `create-${id}` },
      body: JSON.stringify({ id, name: "検証用図面", unit: "mm" })
    }),
    env
  );
  assert.equal(response.status, 201, await response.clone().text());
}

function transactionRequest(drawingId, { commands, expectedVersion, key }) {
  const headers = {
    "content-type": "application/json",
    "x-demo-role": "drafter",
    "idempotency-key": key
  };
  if (expectedVersion !== undefined) headers["expected-version"] = expectedVersion;
  return new Request(`https://example.test/api/drawings/${drawingId}/transactions`, {
    method: "POST",
    headers,
    body: JSON.stringify({ label: "検証", commands })
  });
}

test("commandsが配列でない場合は500ではなく400で拒否する", async () => {
  resetMemoryStore();
  await createBlankDrawing("dwg_h1");
  const response = await handleApiRequest(
    transactionRequest("dwg_h1", { commands: "not-an-array", expectedVersion: "1", key: "tx-h1" }),
    env
  );
  const body = await response.json();
  assert.equal(response.status, 400);
  assert.match(body.error, /配列/);
});

test("1回の更新で送信できるコマンド数の上限を超えたら413で拒否する", async () => {
  resetMemoryStore();
  await createBlankDrawing("dwg_h2");
  const commands = Array.from({ length: 501 }, (_, index) => ({ op: "noop", index }));
  const response = await handleApiRequest(
    transactionRequest("dwg_h2", { commands, expectedVersion: "1", key: "tx-h2" }),
    env
  );
  const body = await response.json();
  assert.equal(response.status, 413);
  assert.match(body.error, /500件/);
});

test("上限以内のコマンドは従来どおり適用できる", async () => {
  resetMemoryStore();
  await createBlankDrawing("dwg_h3");
  const response = await handleApiRequest(
    transactionRequest("dwg_h3", { commands: [{ op: "set_empty_drawing_unit", unit: "m" }], expectedVersion: "1", key: "tx-h3" }),
    env
  );
  assert.equal(response.status, 200);
});

test("expected-versionは10進整数リテラルのみ受理する", async () => {
  resetMemoryStore();
  await createBlankDrawing("dwg_h4");
  for (const [index, value] of ["1e0", "0x1", "1.0", "-1", "1_0"].entries()) {
    const response = await handleApiRequest(
      transactionRequest("dwg_h4", { commands: [], expectedVersion: value, key: `tx-h4-${index}` }),
      env
    );
    assert.equal(response.status, 428, `expected-version=${value} は拒否されるべき`);
  }
  const accepted = await handleApiRequest(
    transactionRequest("dwg_h4", { commands: [], expectedVersion: "1", key: "tx-h4-ok" }),
    env
  );
  assert.equal(accepted.status, 200);
});

test("expected-versionが欠落している場合は428で拒否する", async () => {
  resetMemoryStore();
  await createBlankDrawing("dwg_h5");
  const response = await handleApiRequest(transactionRequest("dwg_h5", { commands: [], key: "tx-h5" }), env);
  assert.equal(response.status, 428);
});

test("本文不備で400を返したリクエストは冪等キーを消費せず、同じキーで再送できる", async () => {
  resetMemoryStore();
  const post = (body) =>
    handleApiRequest(
      new Request("https://example.test/api/projects", {
        method: "POST",
        headers: { "content-type": "application/json", "x-demo-role": "cad_admin", "idempotency-key": "project-retry" },
        body: JSON.stringify(body)
      }),
      env
    );

  const invalid = await post({});
  assert.equal(invalid.status, 400);

  const retry = await post({ name: "再送で作成できる案件" });
  assert.equal(retry.status, 201, await retry.clone().text());

  // 成功した後の同一キー再送は、従来どおり二重実行として拒否される。
  const duplicate = await post({ name: "再送で作成できる案件" });
  assert.equal(duplicate.status, 409);
});

test("accessScope不正で400を返したPATCHも冪等キーを消費しない", async () => {
  resetMemoryStore();
  const created = await handleApiRequest(
    new Request("https://example.test/api/projects", {
      method: "POST",
      headers: { "content-type": "application/json", "x-demo-role": "cad_admin", "idempotency-key": "patch-create" },
      body: JSON.stringify({ id: "prj_patch_check", name: "PATCH検証" })
    }),
    env
  );
  assert.equal(created.status, 201);

  const patch = (body) =>
    handleApiRequest(
      new Request("https://example.test/api/projects/prj_patch_check", {
        method: "PATCH",
        headers: { "content-type": "application/json", "x-demo-role": "cad_admin", "idempotency-key": "project-patch-retry" },
        body: JSON.stringify(body)
      }),
      env
    );

  assert.equal((await patch({ accessScope: "invalid" })).status, 400);
  assert.equal((await patch({ accessScope: "restricted" })).status, 200);
});

test("監査CSVは先頭に空白・制御文字がある数式も無害化する", () => {
  // 到達経路(HTTPヘッダ/JWT)ではトリムされることが多いが、汎用エスケープとして
  // 先頭空白を読み飛ばす表計算ソフトの挙動まで塞いでおく。
  assert.equal(csvEscape(" =1+1@example.com"), "' =1+1@example.com");
  assert.equal(csvEscape("\t=cmd"), "'\t=cmd");
  assert.equal(csvEscape("\r@SUM(1)"), "\"'\r@SUM(1)\"");
  assert.equal(csvEscape("通常の値"), "通常の値");
  assert.equal(csvEscape('=a,"b"'), '"\'=a,""b"""');
});

test("監査CSVは数式で始まる値を無害化する(到達経路)", async () => {
  resetMemoryStore();
  const created = await handleApiRequest(
    new Request("https://example.test/api/projects", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-demo-role": "cad_admin",
        "x-demo-actor": "=1+1@example.com",
        "idempotency-key": "csv-proj"
      },
      body: JSON.stringify({ name: "CSV検証" })
    }),
    env
  );
  assert.equal(created.status, 201);

  const csv = await handleApiRequest(
    new Request("https://example.test/api/audit-logs?format=csv", { headers: { "x-demo-role": "approver" } }),
    env
  );
  assert.equal(csv.status, 200);
  const body = await csv.text();
  assert.ok(body.includes("'=1+1@example.com"), `数式が無害化されていない:\n${body}`);
});

test("監査CSVの通常の値は従来どおり素通しする", async () => {
  resetMemoryStore();
  const created = await handleApiRequest(
    new Request("https://example.test/api/projects", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-demo-role": "cad_admin",
        "x-demo-actor": "cad-admin@example.com",
        "idempotency-key": "csv-proj-2"
      },
      body: JSON.stringify({ name: "CSV通常検証" })
    }),
    env
  );
  assert.equal(created.status, 201);
  const csv = await handleApiRequest(
    new Request("https://example.test/api/audit-logs?format=csv", { headers: { "x-demo-role": "approver" } }),
    env
  );
  const body = await csv.text();
  assert.ok(body.includes("cad-admin@example.com"));
  assert.equal(body.includes("'cad-admin@example.com"), false);
});
