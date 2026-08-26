import test from "node:test";
import assert from "node:assert/strict";
import { handleApiRequest, resetMemoryStore } from "../src/api-handler.js";

const env = { AUTH_MODE: "demo", APP_ENV: "preview" };

test("health returns auth and database preview status", async () => {
  resetMemoryStore();
  const response = await handleApiRequest(new Request("https://example.test/api/health"), env);
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.auth.mode, "demo");
  assert.equal(body.db.mode, "memory-preview");
});

test("OPTIONS preflight returns an empty 204 response", async () => {
  const response = await handleApiRequest(
    new Request("https://example.test/api/health", { method: "OPTIONS" }),
    env
  );
  assert.equal(response.status, 204);
  assert.equal(await response.text(), "");
});

test("drawing creation supports blank and demo templates", async () => {
  resetMemoryStore();
  const create = (template, idempotencyKey = `create-${template}`) =>
    handleApiRequest(
      new Request("https://example.test/api/drawings", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-demo-role": "drafter",
          "idempotency-key": idempotencyKey
        },
        body: JSON.stringify({ name: `${template} drawing`, unit: "m", template })
      }),
      env
    );
  const blank = await (await create("blank")).json();
  const demo = await (await create("demo")).json();
  assert.equal(blank.drawing.entities.length, 0);
  assert.equal(blank.drawing.name, "blank drawing");
  assert.equal(blank.drawing.unit, "m");
  assert.ok(demo.drawing.entities.length > 0);

  const duplicate = await create("blank", "create-blank");
  assert.equal(duplicate.status, 409);

  const invalidBody = await handleApiRequest(
    new Request("https://example.test/api/drawings", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-demo-role": "drafter",
        "idempotency-key": "create-invalid"
      },
      body: "null"
    }),
    env
  );
  assert.equal(invalidBody.status, 400);
});

test("production access mode permits only public health and demo drawing reads", async () => {
  resetMemoryStore();
  const productionEnv = {
    APP_ENV: "production",
    AUTH_MODE: "access"
  };
  const health = await handleApiRequest(new Request("https://example.test/api/health"), productionEnv);
  const healthBody = await health.json();
  assert.equal(health.status, 200);
  assert.equal(healthBody.auth.role, "viewer");
  assert.equal(healthBody.auth.anonymous, true);
  assert.equal("database" in healthBody.db, false);

  const demo = await handleApiRequest(new Request("https://example.test/api/drawings/demo"), productionEnv);
  assert.equal(demo.status, 200);

  const arbitrary = await handleApiRequest(new Request("https://example.test/api/drawings/dwg_private"), productionEnv);
  assert.equal(arbitrary.status, 401);

  const mutation = await handleApiRequest(
    new Request("https://example.test/api/drawings", { method: "POST", body: "{}" }),
    productionEnv
  );
  assert.equal(mutation.status, 401);
});

test("API applies production security and CORS headers", async () => {
  const response = await handleApiRequest(new Request("https://example.test/api/health"), {
    APP_ENV: "production",
    AUTH_MODE: "access"
  });
  assert.equal(response.headers.get("access-control-allow-origin"), "https://mirai-web-cad.mirai-dx-platform.com");
  assert.equal(response.headers.get("x-frame-options"), "DENY");
  assert.match(response.headers.get("permissions-policy"), /camera=\(\)/);
});

test("mutating JSON endpoints reject unsupported media types and oversized bodies", async () => {
  resetMemoryStore();
  const unsupported = await handleApiRequest(
    new Request("https://example.test/api/drawings/dwg_demo_001/transactions", {
      method: "POST",
      headers: {
        "content-type": "text/plain",
        "x-demo-role": "drafter",
        "idempotency-key": "media-type",
        "expected-version": "1"
      },
      body: "{}"
    }),
    env
  );
  assert.equal(unsupported.status, 415);

  const oversized = await handleApiRequest(
    new Request("https://example.test/api/drawings/dwg_demo_001/transactions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "content-length": "1048577",
        "x-demo-role": "drafter",
        "idempotency-key": "oversized",
        "expected-version": "1"
      },
      body: "{}"
    }),
    env
  );
  assert.equal(oversized.status, 413);

  const chunkedBody = JSON.stringify({ value: "x".repeat(1_048_576) });
  const chunkedRequest = new Request("https://example.test/api/drawings/dwg_demo_001/transactions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-demo-role": "drafter",
        "idempotency-key": "chunked-oversized",
        "expected-version": "1"
      },
      body: chunkedBody
    });
  assert.equal(chunkedRequest.headers.has("content-length"), false);
  const chunked = await handleApiRequest(chunkedRequest, env);
  assert.equal(chunked.status, 413);
});

test("access mode ignores client role spoofing and uses server role mapping", async () => {
  resetMemoryStore();
  const response = await handleApiRequest(
    new Request("https://example.test/api/health", {
      headers: {
        "cf-access-jwt-assertion": "signed-test-token",
        "cf-access-authenticated-user-email": "attacker@example.com",
        "x-mirai-role": "cad_admin"
      }
    }),
    {
      APP_ENV: "production",
      AUTH_MODE: "access",
      ACCESS_ROLE_MAP: JSON.stringify({ "drafter@example.com": "drafter" }),
      ACCESS_JWT_VERIFIER: async (token) => {
        assert.equal(token, "signed-test-token");
        return { email: "drafter@example.com" };
      }
    }
  );
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.auth.role, "drafter");
});

test("access mode fails closed when JWT verifier configuration is absent", async () => {
  resetMemoryStore();
  const response = await handleApiRequest(
    new Request("https://example.test/api/health", {
      headers: { "cf-access-jwt-assertion": "unverified-token" }
    }),
    { APP_ENV: "production", AUTH_MODE: "access" }
  );
  const body = await response.json();
  assert.equal(response.status, 401);
  assert.match(body.error, /JWT/);
});

test("viewer cannot create transactions", async () => {
  resetMemoryStore();
  const response = await handleApiRequest(
    new Request("https://example.test/api/drawings/dwg_demo_001/transactions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-demo-role": "viewer",
        "idempotency-key": "idem-viewer",
        "expected-version": "1"
      },
      body: JSON.stringify({ label: "viewer transaction", commands: [] })
    }),
    env
  );
  const body = await response.json();
  assert.equal(response.status, 403);
  assert.match(body.error, /権限/);
});

test("transaction requires idempotency and expected version gates", async () => {
  resetMemoryStore();
  const missingIdempotency = await handleApiRequest(
    new Request("https://example.test/api/drawings/dwg_demo_001/transactions", {
      method: "POST",
      headers: { "content-type": "application/json", "x-demo-role": "drafter", "expected-version": "1" },
      body: JSON.stringify({ commands: [] })
    }),
    env
  );
  assert.equal(missingIdempotency.status, 428);

  const wrongVersion = await handleApiRequest(
    new Request("https://example.test/api/drawings/dwg_demo_001/transactions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-demo-role": "drafter",
        "idempotency-key": "idem-wrong",
        "expected-version": "99"
      },
      body: JSON.stringify({ commands: [] })
    }),
    env
  );
  assert.equal(wrongVersion.status, 409);
});

test("duplicate idempotency key cannot execute a transaction twice", async () => {
  resetMemoryStore();
  const request = () =>
    new Request("https://example.test/api/drawings/dwg_demo_001/transactions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-demo-role": "drafter",
        "idempotency-key": "idem-duplicate",
        "expected-version": "1"
      },
      body: JSON.stringify({ label: "duplicate guard", commands: [] })
    });
  const first = await handleApiRequest(request(), env);
  const second = await handleApiRequest(request(), env);
  assert.equal(first.status, 200);
  assert.equal(second.status, 409);
  assert.match((await second.json()).error, /処理済み/);
});

test("successful mutation commits drawing and audit as one logical operation", async () => {
  resetMemoryStore();
  const response = await handleApiRequest(
    new Request("https://example.test/api/drawings/dwg_demo_001/transactions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-demo-role": "drafter",
        "idempotency-key": "atomic-audit",
        "expected-version": "1"
      },
      body: JSON.stringify({ label: "atomic audit", commands: [] })
    }),
    env
  );
  assert.equal(response.status, 200);

  const auditResponse = await handleApiRequest(
    new Request("https://example.test/api/audit-logs", { headers: { "x-demo-role": "approver" } }),
    env
  );
  const auditBody = await auditResponse.json();
  assert.equal(auditBody.auditLogs.filter((entry) => entry.action === "drawing.transaction").length, 1);
});

test("stale revision cannot overwrite a newer transaction", async () => {
  resetMemoryStore();
  const send = (key) =>
    handleApiRequest(
      new Request("https://example.test/api/drawings/dwg_demo_001/transactions", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-demo-role": "drafter",
          "idempotency-key": key,
          "expected-version": "1"
        },
        body: JSON.stringify({ label: key, commands: [] })
      }),
      env
    );
  assert.equal((await send("revision-first")).status, 200);
  const stale = await send("revision-stale");
  assert.equal(stale.status, 409);
  assert.match((await stale.json()).error, /リビジョン/);
});

test("review updates require concurrency and idempotency gates", async () => {
  resetMemoryStore();
  const missingGates = await handleApiRequest(
    new Request("https://example.test/api/drawings/dwg_demo_001/review", {
      method: "POST",
      headers: { "content-type": "application/json", "x-demo-role": "drafter" },
      body: JSON.stringify({ action: "submit" })
    }),
    env
  );
  assert.equal(missingGates.status, 428);

  const submitted = await handleApiRequest(
    new Request("https://example.test/api/drawings/dwg_demo_001/review", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-demo-role": "drafter",
        "idempotency-key": "idem-review-submit",
        "expected-version": "1"
      },
      body: JSON.stringify({ action: "submit" })
    }),
    env
  );
  assert.equal(submitted.status, 200);
  assert.equal((await submitted.json()).drawing.state, "in_review");
});

test("review lifecycle enforces submit, approve, then new version", async () => {
  resetMemoryStore();
  const review = (action, role, revision, key) =>
    handleApiRequest(
      new Request("https://example.test/api/drawings/dwg_demo_001/review", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-demo-role": role,
          "idempotency-key": key,
          "expected-version": String(revision)
        },
        body: JSON.stringify({ action })
      }),
      env
    );

  const submitted = await (await review("submit", "drafter", 1, "lifecycle-submit")).json();
  assert.equal(submitted.drawing.state, "in_review");
  assert.equal(submitted.drawing.revision, 2);

  const approved = await (await review("approve", "approver", 2, "lifecycle-approve")).json();
  assert.equal(approved.drawing.state, "approved");
  assert.equal(approved.drawing.revision, 3);

  const next = await (await review("new_version", "cad_admin", 3, "lifecycle-new-version")).json();
  assert.equal(next.drawing.state, "draft");
  assert.equal(next.drawing.version, 2);
  assert.equal(next.drawing.revision, 4);
});

test("agent run preview then explicit approval mutates drawing", async () => {
  resetMemoryStore();
  const planResponse = await handleApiRequest(
    new Request("https://example.test/api/drawings/dwg_demo_001/agent-runs", {
      method: "POST",
      headers: { "content-type": "application/json", "x-demo-role": "drafter" },
      body: JSON.stringify({ prompt: "クレーンの重機範囲を追加" })
    }),
    env
  );
  const planBody = await planResponse.json();
  assert.equal(planResponse.status, 201);
  assert.equal(planBody.run.status, "planned");

  const before = await (await handleApiRequest(new Request("https://example.test/api/drawings/dwg_demo_001"), env)).json();
  const approveResponse = await handleApiRequest(
    new Request(`https://example.test/api/agent-runs/${planBody.run.id}/approve`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-demo-role": "drafter",
        "idempotency-key": "idem-agent",
        "expected-version": "1"
      },
      body: "{}"
    }),
    env
  );
  const approveBody = await approveResponse.json();
  assert.equal(approveResponse.status, 200);
  assert.equal(approveBody.drawing.entities.length, before.drawing.entities.length + 2);
});

test("approval rejects a proposal when its server-side run is missing", async () => {
  resetMemoryStore();
  const planResponse = await handleApiRequest(
    new Request("https://example.test/api/drawings/dwg_demo_001/agent-runs", {
      method: "POST",
      headers: { "content-type": "application/json", "x-demo-role": "drafter" },
      body: JSON.stringify({ prompt: "注記追加" })
    }),
    env
  );
  const planBody = await planResponse.json();
  resetMemoryStore();

  const approveResponse = await handleApiRequest(
    new Request(`https://example.test/api/agent-runs/${planBody.run.id}/approve`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-demo-role": "drafter",
        "idempotency-key": "idem-stateless-agent",
        "expected-version": "1"
      },
      body: JSON.stringify({ drawingId: planBody.run.drawingId, proposal: planBody.run.proposal })
    }),
    env
  );
  const approveBody = await approveResponse.json();
  assert.equal(approveResponse.status, 404);
  assert.match(approveBody.error, /Agent Run/);
});
