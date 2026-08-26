import {
  ROLE_POLICIES,
  applyTransaction,
  approveDrawing,
  buildAiProposal,
  createDrawing,
  createNewVersion,
  proposalToTransaction,
  seedDrawing,
  submitForReview,
  validateDrawing
} from "./cad-core.js";
import { createDataStore, resetMemoryStoreData } from "./data-store.js";
import { createRemoteJWKSet, jwtVerify } from "jose";

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=()",
  "x-frame-options": "DENY"
};

const MAX_JSON_BYTES = 1_048_576;

export async function handleApiRequest(request, env = {}) {
  const store = createDataStore(env);
  const url = new URL(request.url);
  const startedAt = Date.now();
  const route = normalizeRoute(url.pathname);
  const requestId = request.headers.get("x-request-id")?.slice(0, 100) ?? `req_${cryptoSafeId()}`;

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(env, requestId) });
  }

  try {
    const actor = await resolveActor(request, env, isPublicReadRoute(request.method, route));
    if (!actor.ok) return json({ ok: false, error: actor.error }, 401, corsHeaders(env, requestId));

    if (request.method === "GET" && route === "/health") {
      const db = await store.probe();
      return json(
        {
          ok: true,
          service: "mirai-web-cad-api",
          auth: {
            mode: authMode(env),
            actor: actor.actor.id,
            role: actor.actor.role,
            anonymous: actor.actor.anonymous === true
          },
          db: actor.actor.anonymous ? sanitizeProbe(db) : db,
          durationMs: Date.now() - startedAt
        },
        200,
        corsHeaders(env, requestId)
      );
    }

    if (request.method === "GET" && route === "/drawings/demo") {
      const drawing = actor.actor.anonymous
        ? await getPublicDrawing(store, "dwg_demo_001")
        : await getDrawing(store, "dwg_demo_001");
      return json({ ok: true, drawing }, 200, corsHeaders(env, requestId));
    }

    if (request.method === "POST" && route === "/drawings") {
      authorize(actor.actor, "canEdit");
      const idempotencyKey = requireIdempotency(request);
      await rejectClaimedIdempotency(store, idempotencyKey);
      const body = await readJson(request);
      if (!body || typeof body !== "object" || Array.isArray(body)) {
        throw httpError("JSON本文はオブジェクトである必要があります。", 400);
      }
      const drawing = body.template === "demo" ? seedDrawing() : createDrawing();
      drawing.id = typeof body.id === "string" && /^dwg_[a-z0-9_-]{1,60}$/i.test(body.id) ? body.id : `dwg_${cryptoSafeId()}`;
      drawing.name = typeof body.name === "string" ? body.name.trim().slice(0, 100) || "新規図面" : "新規図面";
      drawing.unit = ["mm", "m"].includes(body.unit) ? body.unit : "mm";
      drawing.currentRole = actor.actor.role;
      const created = await store.createDrawingAtomically(
        drawing,
        createAuditEntry(actor.actor, "drawing.created", "drawing", drawing.id, { name: drawing.name }),
        idempotencyKey,
        actor.actor.id,
        route
      );
      if (!created) throw httpError("同じIdempotency-Keyまたは図面IDは処理済みです。", 409);
      return json({ ok: true, drawing }, 201, corsHeaders(env, requestId));
    }

    const drawingMatch = route.match(/^\/drawings\/([^/]+)$/);
    if (request.method === "GET" && drawingMatch) {
      return json({ ok: true, drawing: await getDrawing(store, drawingMatch[1]) }, 200, corsHeaders(env, requestId));
    }

    const transactionMatch = route.match(/^\/drawings\/([^/]+)\/transactions$/);
    if (request.method === "POST" && transactionMatch) {
      authorize(actor.actor, "canEdit");
      const drawing = withActor(await getDrawing(store, transactionMatch[1]), actor.actor);
      const body = await readJson(request);
      const idempotencyKey = requireIdempotency(request);
      await rejectClaimedIdempotency(store, idempotencyKey);
      requireExpectedVersion(request, drawing);
      const result = applyTransaction(drawing, {
        source: "user",
        actor: actor.actor.id,
        label: body.label ?? "API transaction",
        commands: body.commands ?? []
      });
      if (!result.ok) return json({ ok: false, error: result.error }, 409, corsHeaders(env, requestId));
      await saveMutationAtomically(store, result.drawing, actor.actor, "drawing.transaction", drawing.id, { label: body.label }, idempotencyKey, route);
      return json({ ok: true, drawing: result.drawing, warnings: result.warnings }, 200, corsHeaders(env, requestId));
    }

    const agentMatch = route.match(/^\/drawings\/([^/]+)\/agent-runs$/);
    if (request.method === "POST" && agentMatch) {
      authorize(actor.actor, "canRunAi");
      const drawing = withActor(await getDrawing(store, agentMatch[1]), actor.actor);
      const body = await readJson(request);
      const proposal = buildAiProposal(drawing, body.prompt ?? "");
      const run = {
        id: `run_${cryptoSafeId()}`,
        drawingId: drawing.id,
        status: proposal.status,
        prompt: body.prompt ?? "",
        proposal,
        createdBy: actor.actor.id,
        createdAt: new Date().toISOString()
      };
      await store.saveAgentRun(run);
      await audit(store, actor.actor, "agent.planned", "agent_run", run.id, { status: run.status });
      return json({ ok: true, run }, proposal.status === "planned" ? 201 : 202, corsHeaders(env, requestId));
    }

    const approveAgentMatch = route.match(/^\/agent-runs\/([^/]+)\/approve$/);
    if (request.method === "POST" && approveAgentMatch) {
      authorize(actor.actor, "canEdit");
      const idempotencyKey = requireIdempotency(request);
      await rejectClaimedIdempotency(store, idempotencyKey);
      await readJson(request);
      const run = await getAgentRun(store, approveAgentMatch[1]);
      if (run.proposal.status !== "planned") {
        return json({ ok: false, error: "適用可能なAI提案ではありません。" }, 409, corsHeaders(env, requestId));
      }
      const drawing = withActor(await getDrawing(store, run.drawingId), actor.actor);
      requireExpectedVersion(request, drawing);
      const result = applyTransaction(drawing, proposalToTransaction(run.proposal, actor.actor.id));
      if (!result.ok) return json({ ok: false, error: result.error }, 409, corsHeaders(env, requestId));
      run.status = "completed";
      await saveMutationAtomically(
        store,
        result.drawing,
        actor.actor,
        "agent.approved",
        drawing.id,
        { runId: run.id },
        idempotencyKey,
        route,
        run
      );
      return json({ ok: true, drawing: result.drawing, run }, 200, corsHeaders(env, requestId));
    }

    const reviewMatch = route.match(/^\/drawings\/([^/]+)\/review$/);
    if (request.method === "POST" && reviewMatch) {
      const drawing = withActor(await getDrawing(store, reviewMatch[1]), actor.actor);
      const body = await readJson(request);
      if (body.action === "submit") authorize(actor.actor, "canEdit");
      else if (body.action === "approve" || body.action === "new_version") authorize(actor.actor, "canApprove");
      else return json({ ok: false, error: "review actionが不正です。" }, 400, corsHeaders(env, requestId));
      const idempotencyKey = requireIdempotency(request);
      await rejectClaimedIdempotency(store, idempotencyKey);
      requireExpectedVersion(request, drawing);
      if (body.action === "submit") {
        if (!["draft", "rejected"].includes(drawing.state)) {
          return json({ ok: false, error: "下書きまたは差戻し図面だけをレビュー提出できます。" }, 409, corsHeaders(env, requestId));
        }
        const next = submitForReview(drawing, actor.actor.id);
        await saveMutationAtomically(store, next, actor.actor, "review.submitted", drawing.id, {}, idempotencyKey, route);
        return json({ ok: true, drawing: next }, 200, corsHeaders(env, requestId));
      }
      if (body.action === "approve") {
        const result = approveDrawing(drawing, actor.actor.id);
        if (!result.ok) return json({ ok: false, error: result.error, issues: validateDrawing(drawing) }, 409, corsHeaders(env, requestId));
        await saveMutationAtomically(store, result.drawing, actor.actor, "review.approved", drawing.id, {}, idempotencyKey, route);
        return json({ ok: true, drawing: result.drawing }, 200, corsHeaders(env, requestId));
      }
      if (body.action === "new_version") {
        if (drawing.state !== "approved") {
          return json({ ok: false, error: "承認済み図面からのみ新版を作成できます。" }, 409, corsHeaders(env, requestId));
        }
        const next = createNewVersion(drawing, actor.actor.id);
        await saveMutationAtomically(store, next, actor.actor, "drawing.version.created", drawing.id, {}, idempotencyKey, route);
        return json({ ok: true, drawing: next }, 200, corsHeaders(env, requestId));
      }
    }

    if (request.method === "GET" && route === "/audit-logs") {
      authorize(actor.actor, "canApprove");
      return json({ ok: true, auditLogs: await store.listAuditLogs(100) }, 200, corsHeaders(env, requestId));
    }

    return json({ ok: false, error: "not found" }, 404, corsHeaders(env, requestId));
  } catch (error) {
    const status = error instanceof Error && "status" in error ? Number(error.status) : 500;
    if (status >= 500) console.error(`[${requestId}] API request failed`, error);
    const message = status >= 500 && env.APP_ENV === "production" ? "internal error" : error instanceof Error ? error.message : "internal error";
    return json({ ok: false, error: message }, status, corsHeaders(env, requestId));
  }
}

export function resetMemoryStore() {
  resetMemoryStoreData();
}

async function resolveActor(request, env, allowAnonymous = false) {
  const mode = authMode(env);
  if (mode === "demo") {
    const role = request.headers.get("x-demo-role") ?? "drafter";
    if (!ROLE_POLICIES[role]) return { ok: false, error: "不正なデモ権限です。" };
    return { ok: true, actor: { id: request.headers.get("x-demo-actor") ?? "demo@example.com", role } };
  }

  const accessJwt = request.headers.get("cf-access-jwt-assertion");
  if (!accessJwt) {
    if (allowAnonymous) {
      return { ok: true, actor: { id: "anonymous", role: "viewer", anonymous: true } };
    }
    return { ok: false, error: "Cloudflare Access認証情報を確認できません。" };
  }
  let claims;
  try {
    claims = env.ACCESS_JWT_VERIFIER
      ? await env.ACCESS_JWT_VERIFIER(accessJwt)
      : await verifyAccessJwt(accessJwt, env);
  } catch {
    return { ok: false, error: "Cloudflare Access JWTを検証できません。" };
  }
  const jwtEmail = claims.email;
  if (typeof jwtEmail !== "string" || !jwtEmail.includes("@")) {
    return { ok: false, error: "Cloudflare Access JWTにemail claimがありません。" };
  }
  const roleMap = parseRoleMap(env.ACCESS_ROLE_MAP);
  const role = roleMap[jwtEmail.toLowerCase()] ?? env.ACCESS_DEFAULT_ROLE ?? "viewer";
  if (!ROLE_POLICIES[role]) return { ok: false, error: "Access権限設定が不正です。" };
  return { ok: true, actor: { id: jwtEmail, role } };
}

async function verifyAccessJwt(token, env) {
  if (!env.CF_ACCESS_TEAM_DOMAIN || !env.CF_ACCESS_AUD) {
    throw new Error("Access JWT verifier configuration is missing");
  }
  const issuer = `https://${env.CF_ACCESS_TEAM_DOMAIN.replace(/^https?:\/\//, "").replace(/\/$/, "")}`;
  const jwks = createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`));
  const { payload } = await jwtVerify(token, jwks, {
    issuer,
    audience: env.CF_ACCESS_AUD
  });
  return payload;
}

function parseRoleMap(value) {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function authMode(env) {
  if (env.AUTH_MODE) return env.AUTH_MODE;
  return env.APP_ENV === "production" ? "access" : "demo";
}

function authorize(actor, capability) {
  const policy = ROLE_POLICIES[actor.role] ?? ROLE_POLICIES.viewer;
  if (!policy[capability]) {
    throw httpError(`${policy.label}には${capability}権限がありません。`, 403);
  }
}

async function getDrawing(store, id) {
  const drawing = await store.getDrawing(id);
  if (!drawing) {
    throw httpError(`図面が見つかりません: ${id}`, 404);
  }
  return drawing;
}

async function getPublicDrawing(store, id) {
  const drawing = await store.getPublicDrawing(id);
  if (!drawing) throw httpError("公開図面が見つかりません。", 404);
  return drawing;
}

async function getAgentRun(store, id) {
  const run = await store.getAgentRun(id);
  if (!run) {
    throw httpError(`Agent Runが見つかりません: ${id}`, 404);
  }
  return run;
}

function withActor(drawing, actor) {
  return { ...drawing, currentRole: actor.role };
}

function requireIdempotency(request) {
  const key = request.headers.get("idempotency-key");
  if (!key) {
    throw httpError("Idempotency-Keyが必要です。", 428);
  }
  return key;
}

function requireExpectedVersion(request, drawing) {
  const expected = Number(request.headers.get("expected-version"));
  if (!Number.isFinite(expected)) {
    throw httpError("expected-versionが必要です。", 428);
  }
  const actual = drawing.revision ?? 1;
  if (expected !== actual) {
    throw httpError(`リビジョンが競合しています。expected=${expected}, actual=${actual}`, 409);
  }
}

async function rejectClaimedIdempotency(store, key) {
  if (await store.hasIdempotency(key)) {
    throw httpError("同じIdempotency-Keyのリクエストは処理済みです。", 409);
  }
}

async function readJson(request) {
  if (!request.body) return {};
  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.startsWith("application/json")) {
    throw httpError("Content-Type: application/jsonが必要です。", 415);
  }
  const declaredSize = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredSize) && declaredSize > MAX_JSON_BYTES) {
    throw httpError("JSON本文が1 MiBを超えています。", 413);
  }
  const reader = request.body.getReader();
  /** @type {Uint8Array[]} */
  const chunks = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > MAX_JSON_BYTES) {
      await reader.cancel();
      throw httpError("JSON本文が1 MiBを超えています。", 413);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const text = new TextDecoder().decode(bytes);
  if (!text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw httpError("JSON本文が不正です。", 400);
  }
}

function normalizeRoute(pathname) {
  return pathname.replace(/^\/api\/v1/, "").replace(/^\/api/, "") || "/";
}

function isPublicReadRoute(method, route) {
  return method === "GET" && (route === "/health" || route === "/drawings/demo");
}

function sanitizeProbe(db) {
  return {
    provider: db.provider,
    mode: db.mode,
    migrated: db.migrated ?? db.mode === "memory-preview"
  };
}

function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { ...JSON_HEADERS, ...headers }
  });
}

function corsHeaders(env, requestId) {
  const origin = env.CORS_ORIGIN ?? (env.APP_ENV === "production" ? "https://mirai-web-cad.mirai-dx-platform.com" : "*");
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type,idempotency-key,expected-version,x-demo-role,x-demo-actor,x-request-id",
    "x-request-id": requestId
  };
}

async function saveMutationAtomically(store, drawing, actor, action, targetId, detail, idempotencyKey, route, agentRun = null) {
  const saved = await store.saveDrawingAtomically(
    drawing,
    createAuditEntry(actor, action, "drawing", targetId, detail),
    idempotencyKey,
    actor.id,
    route,
    agentRun
  );
  if (!saved) throw httpError("同じIdempotency-Keyのリクエストは処理済みです。", 409);
}

async function audit(store, actor, action, targetType, targetId, detail) {
  await store.appendAudit(createAuditEntry(actor, action, targetType, targetId, detail));
}

function createAuditEntry(actor, action, targetType, targetId, detail) {
  return {
    id: `audit_${cryptoSafeId()}`,
    actorId: actor.id,
    role: actor.role,
    action,
    targetType,
    targetId,
    detail,
    createdAt: new Date().toISOString()
  };
}

function httpError(message, status) {
  return Object.assign(new Error(message), { status });
}

function cryptoSafeId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID().slice(0, 12);
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}
