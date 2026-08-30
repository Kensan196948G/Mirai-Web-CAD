// 本番用の常時稼働HTTPサーバー(systemd管理、Cloudflare Tunnel経由で公開)。
// scripts/serve-local.mjsとは意図的に分離している(理由はdocs/operations.mdおよび
// .claude/plans/参照)。ローカル開発サーバーは緩い既定値で動くが、本番はセキュリティ
// 上重要な環境変数(認証モード等)を必須化し、欠落時は起動そのものを拒否する。
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { handleApiRequest } from "../src/api-handler.js";
import { closeDataStorePool, createDataStore } from "../src/data-store.js";
import { ROLE_POLICIES } from "../src/cad-core.js";
import {
  CONTENT_TYPES,
  RequestBodyTooLargeError,
  loadHeaderRules,
  makeHeadersResolver,
  nodeRequestToFetchRequest,
  resolveStaticFile,
  toResolvedPathname,
  writeFetchResponse
} from "./lib/http-bridge.mjs";

const root = process.cwd();
const staticRoot = path.join(root, "dist");
const port = Number(process.env.PORT ?? 18812);
const host = "127.0.0.1"; // 0.0.0.0にしない。インバウンドはCloudflare Tunnelのみを経由させる
const shutdownTimeoutMs = Number(process.env.SHUTDOWN_TIMEOUT_MS ?? 10000);

const env = validateEnv();

log("info", "starting", { port, host, appEnv: env.APP_ENV, authMode: env.AUTH_MODE });

await failFastProbe(env);

const headerRules = await loadHeaderRules(path.join(root, "_headers"));
const headersForPath = makeHeadersResolver(headerRules);

const server = createServer(async (req, res) => {
  const startedAt = Date.now();
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  try {
    if (url.pathname.startsWith("/api")) {
      const request = await nodeRequestToFetchRequest(req, url);
      const response = await handleApiRequest(request, env);
      await writeFetchResponse(res, response);
      logRequest(req, url, response.status, startedAt);
      return;
    }

    const file = await resolveStaticFile(staticRoot, url.pathname);
    if (!file) {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      res.end("not found");
      logRequest(req, url, 404, startedAt);
      return;
    }
    const ext = path.extname(file);
    const resolvedPathname = toResolvedPathname(staticRoot, file);
    res.writeHead(200, {
      "content-type": CONTENT_TYPES[ext] ?? "application/octet-stream",
      "x-content-type-options": "nosniff",
      "strict-transport-security": "max-age=63072000; includeSubDomains; preload",
      ...headersForPath(resolvedPathname)
    });
    res.end(await readFile(file));
    logRequest(req, url, 200, startedAt);
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      if (!res.headersSent) res.writeHead(413, { "content-type": "text/plain; charset=utf-8" });
      res.end("payload too large");
      logRequest(req, url, 413, startedAt);
      return;
    }
    log("error", "unhandled request error", { path: url.pathname, error: errorMessage(error) });
    if (!res.headersSent) res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
    res.end("internal error");
  }
});

server.listen(port, host, () => {
  log("info", "listening", { url: `http://${host}:${port}/` });
});

let shuttingDown = false;
for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => shutdown(signal));
}
process.on("unhandledRejection", (reason) => {
  log("error", "unhandledRejection", { error: errorMessage(reason) });
  shutdown("unhandledRejection", 1);
});
process.on("uncaughtException", (error) => {
  log("error", "uncaughtException", { error: errorMessage(error) });
  shutdown("uncaughtException", 1);
});

async function shutdown(reason, exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  log("info", "shutting down", { reason });
  const timer = setTimeout(() => {
    log("warn", "shutdown timeout exceeded, forcing exit", { shutdownTimeoutMs });
    process.exit(exitCode || 1);
  }, shutdownTimeoutMs);
  timer.unref();
  server.close(async () => {
    try {
      await closeDataStorePool();
    } catch (error) {
      log("error", "error closing data store pool", { error: errorMessage(error) });
    } finally {
      clearTimeout(timer);
      process.exit(exitCode);
    }
  });
  if (typeof server.closeIdleConnections === "function") server.closeIdleConnections();
}

function validateEnv() {
  const missing = [];
  const databaseUrl = requireEnv("DATABASE_URL", missing);
  const appEnv = process.env.APP_ENV;
  if (appEnv !== "production") missing.push("APP_ENV(must be 'production')");
  const authMode = process.env.AUTH_MODE;
  if (authMode !== "access") missing.push("AUTH_MODE(must be 'access', not 'demo')");
  const cfAccessTeamDomain = requireEnv("CF_ACCESS_TEAM_DOMAIN", missing);
  const cfAccessAud = requireEnv("CF_ACCESS_AUD", missing);
  const corsOrigin = requireEnv("CORS_ORIGIN", missing);
  const accessRoleMapRaw = requireEnv("ACCESS_ROLE_MAP", missing);

  const aiProvider = process.env.AI_PROVIDER;
  if (aiProvider !== undefined && aiProvider !== "openai" && aiProvider !== "anthropic") {
    missing.push("AI_PROVIDER(must be 'openai' or 'anthropic' if set)");
  }
  if (aiProvider === "openai" && !process.env.OPENAI_API_KEY) missing.push("OPENAI_API_KEY(required when AI_PROVIDER=openai)");
  if (aiProvider === "anthropic" && !process.env.ANTHROPIC_API_KEY) missing.push("ANTHROPIC_API_KEY(required when AI_PROVIDER=anthropic)");
  if (aiProvider && !process.env.AI_MODEL) missing.push("AI_MODEL(required when AI_PROVIDER is set)");

  if (missing.length > 0) {
    log("error", "missing or invalid required environment variables, refusing to start", { missing });
    process.exit(78); // EX_CONFIG
  }

  let accessRoleMap;
  try {
    accessRoleMap = JSON.parse(accessRoleMapRaw);
  } catch (error) {
    log("error", "ACCESS_ROLE_MAP is not valid JSON, refusing to start", { error: errorMessage(error) });
    process.exit(78);
  }
  if (!accessRoleMap || typeof accessRoleMap !== "object" || Array.isArray(accessRoleMap)) {
    log("error", "ACCESS_ROLE_MAP must be a JSON object, refusing to start");
    process.exit(78);
  }
  const unknownRoles = Object.entries(accessRoleMap).filter(([, role]) => !ROLE_POLICIES[role]);
  if (unknownRoles.length > 0) {
    // メールアドレス(個人識別子)はログへ残さない。件数と不正なロール名のみ出力する。
    log("error", "ACCESS_ROLE_MAP contains unknown roles, refusing to start", {
      unknownCount: unknownRoles.length,
      unknownRoleValues: [...new Set(unknownRoles.map(([, role]) => role))]
    });
    process.exit(78);
  }

  return {
    AUTH_MODE: authMode,
    APP_ENV: appEnv,
    DATABASE_URL: databaseUrl,
    ACCESS_ROLE_MAP: accessRoleMapRaw,
    ACCESS_DEFAULT_ROLE: process.env.ACCESS_DEFAULT_ROLE,
    CF_ACCESS_TEAM_DOMAIN: cfAccessTeamDomain,
    CF_ACCESS_AUD: cfAccessAud,
    CORS_ORIGIN: corsOrigin,
    AI_PROVIDER: aiProvider,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    AI_MODEL: process.env.AI_MODEL,
    AI_RATE_LIMIT_PER_MINUTE: process.env.AI_RATE_LIMIT_PER_MINUTE
  };
}

function requireEnv(name, missing) {
  const value = process.env[name];
  if (!value) {
    missing.push(name);
    return undefined;
  }
  return value;
}

async function failFastProbe(currentEnv) {
  const store = createDataStore(currentEnv);
  try {
    const probe = await store.probe();
    if (probe.mode !== "connected" || probe.migrated !== true) {
      log("error", "database probe failed at startup, refusing to start", { probe });
      process.exit(1);
    }
    log("info", "database probe ok", { database: probe.database, migrated: probe.migrated });
  } catch (error) {
    log("error", "database probe threw at startup, refusing to start", { error: errorMessage(error) });
    process.exit(1);
  }
}

function logRequest(req, url, status, startedAt) {
  log("info", "request", {
    method: req.method,
    path: url.pathname,
    status,
    durationMs: Date.now() - startedAt
  });
}

function log(level, msg, fields = {}) {
  // 接続文字列・JWT・Cookie・リクエストボディは絶対にログしない。呼び出し側で
  // そうしたフィールドを渡さないこと。
  console.log(JSON.stringify({ ts: new Date().toISOString(), level, msg, ...fields }));
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
